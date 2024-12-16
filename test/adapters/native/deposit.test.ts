import hre from 'hardhat';
// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import {assert, expect} from "chai";
import {parseEther, WalletClient} from "viem";
import {createBtcDepositData, deploySourceChainContracts, mpcAddress} from "../../helpers";
import {ContractTypesMap} from "hardhat/types";
import {loadFixture} from '@nomicfoundation/hardhat-network-helpers';




describe("Bridge - [deposit - native token]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;

  const expectedDepositNonce = BigInt(1);
  const emptySetResourceData = "0x";
  const resourceID = "0x0000000000000000000000000000000000000000000000000000000000000650";
  const btcrecipient = "bc1qs0fcdq73vgurej48yhtupzcv83un2p5qhsje7n";
  const depositAmount = parseEther("1");
  const fee = parseEther("0.1");
  const transferredAmount = depositAmount - fee;

  let BridgeInstance: ContractTypesMap["Bridge"];
  let DefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];
  let NativeTokenHandlerInstance: ContractTypesMap["NativeTokenHandler"];
  let BasicFeeHandlerInstance: ContractTypesMap["BasicFeeHandler"];
  let FeeHandlerRouterInstance: ContractTypesMap["FeeHandlerRouter"];
  let NativeTokenTransferGatewayInstance: ContractTypesMap["NativeTokenTransferGateway"];

  let depositor: WalletClient;
  let invalidAdapterMock: WalletClient;

  before(async () => {
    ({
      DefaultMessageReceiverInstance,
      BridgeInstance,
      NativeTokenHandlerInstance,
      BasicFeeHandlerInstance,
      FeeHandlerRouterInstance,
      NativeTokenTransferGatewayInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      depositor,
      invalidAdapterMock
    ] = await hre.viem.getWalletClients();

    await BridgeInstance.write.adminSetResource([
        NativeTokenHandlerInstance.address,
        resourceID,
        NativeTokenHandlerInstance.address,
        emptySetResourceData
      ]);
    await BasicFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);
    await BridgeInstance.write.adminChangeFeeHandler([FeeHandlerRouterInstance.address]),
    await FeeHandlerRouterInstance.write.adminSetResourceHandler([
      destinationDomainID,
      resourceID,
      BasicFeeHandlerInstance.address
    ]);

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("Native token deposit can be made", async () => {
    await expect(
      await NativeTokenTransferGatewayInstance.write.deposit([
        destinationDomainID,
        btcrecipient
      ],
        {
           account: depositor.account,
          value: depositAmount,
        }
      )
    ).not.to.be.reverted;
  });

  it("_depositCounts should be increments from 0 to 1", async () => {
    await NativeTokenTransferGatewayInstance.write.deposit([
      destinationDomainID,
      btcrecipient
    ],
      {
         account: depositor.account,
        value: depositAmount,
      }
    );

    const depositCount = await BridgeInstance.read._depositCounts(
      [destinationDomainID]
    );
    assert.strictEqual(depositCount, expectedDepositNonce);
  });

  it("Deposit event is fired with expected value", async () => {
    const depositTx = await NativeTokenTransferGatewayInstance.write.deposit([
      destinationDomainID,
      btcrecipient
    ],
      {
        account: depositor.account,
        value: depositAmount,
      }
    );

    const depositData = createBtcDepositData(transferredAmount, btcrecipient);

    await expect(depositTx).to.emit(BridgeInstance, "Deposit").withArgs(
      destinationDomainID,
      resourceID.toLowerCase(),
      expectedDepositNonce,
      NativeTokenTransferGatewayInstance.address,
      depositData,
      null
    )
  });

  it("Should revert if destination domain is current bridge domain", async () => {
    await expect(
      NativeTokenTransferGatewayInstance.write.deposit([originDomainID, btcrecipient],
      {
         account: depositor.account,
        value: depositAmount
      })
    ).to.be.reverted;
  });

  it("Should revert if sender is not native token adapter", async () => {
    const NativeTokenHandlerInstance = await hre.viem.deployContract("NativeTokenHandler",
      [
        BridgeInstance.address,
        invalidAdapterMock.address,
        DefaultMessageReceiverInstance.address
      ]);

    await BridgeInstance.write.adminSetResource([
      NativeTokenHandlerInstance.address,
      resourceID,
      NativeTokenHandlerInstance.address,
      emptySetResourceData
    ]);

    await expect(
      NativeTokenTransferGatewayInstance.write.deposit([destinationDomainID, btcrecipient],
      {
         account: depositor.account,
        value: depositAmount
      })
    ).to.be.reverted;
  });
});
