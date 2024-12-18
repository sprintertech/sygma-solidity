import hre from 'hardhat';
// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import {createPublicClient, formatEther, formatUnits, Hex, http, parseEther, toHex, WalletClient, zeroAddress} from "viem";
import {createERCDepositData, deploySourceChainContracts, getBalance, mpcAddress} from "../../helpers";
import {assert, expect} from "chai";
import {ContractTypesMap} from "hardhat/types";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {hardhat, localhost, mainnet} from 'viem/chains';


describe("Native token adapter - [distributeFee]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;

  const tokenDecimals = 18;
  const emptySetResourceData = "0x";
  const resourceID = toHex(650, {size:32});
  const btcrecipient = "bc1qs0fcdq73vgurej48yhtupzcv83un2p5qhsje7n";
  const depositAmount = parseEther("1");
  const fee = parseEther("0.1");
  const transferredAmount = depositAmount - fee;

  let BridgeInstance: ContractTypesMap["Bridge"];
  let FeeHandlerRouterInstance: ContractTypesMap["FeeHandlerRouter"];
  let NativeTokenHandlerInstance: ContractTypesMap["NativeTokenHandler"];
  let NativeTokenTransferGatewayInstance: ContractTypesMap["NativeTokenTransferGateway"];
  let BasicFeeHandlerInstance: ContractTypesMap["BasicFeeHandler"];

  let nonAdmin: WalletClient;
  let depositor: WalletClient;
  let recipient: WalletClient;
  let firstEOA: WalletClient;
  let secondEOA: WalletClient;

  let depositData: Hex;

  beforeEach(async () => {
    ({
      BridgeInstance,
      NativeTokenHandlerInstance,
      BasicFeeHandlerInstance,
      FeeHandlerRouterInstance,
      NativeTokenTransferGatewayInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      nonAdmin,
      depositor,
      recipient,
      firstEOA,
      secondEOA
    ] = await hre.viem.getWalletClients();

    await BridgeInstance.write.adminSetResource([
      NativeTokenHandlerInstance.address,
      resourceID,
      NativeTokenHandlerInstance.address,
      emptySetResourceData
    ]);

    depositData = createERCDepositData(
      depositAmount,
      20,
      recipient.account!.address
    );

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("should distribute fees", async () => {
    await BridgeInstance.write.adminChangeFeeHandler([BasicFeeHandlerInstance.address]);
    await BasicFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);
    const configuredFee = (await BasicFeeHandlerInstance.read._domainResourceIDToFee([
      destinationDomainID,
      resourceID
      ]))
    assert.equal(
      parseEther(configuredFee.toString()),
      parseEther(fee.toString())
    );

    // check the balance is 0
    assert.equal(
      await getBalance(BridgeInstance),
      BigInt(0)
    );
    await NativeTokenTransferGatewayInstance.write.deposit([
      destinationDomainID,
      btcrecipient
    ],
      {
        account: depositor!.account,
        value: depositAmount
      }
    );

    assert.equal(
      await getBalance(BridgeInstance),
      BigInt(0)
    );
    assert.equal(
      await getBalance(NativeTokenTransferGatewayInstance),
      BigInt(0)
    );
    assert.equal(
      await getBalance(NativeTokenHandlerInstance),
      transferredAmount
    );

    const firstEOABefore = await getBalance(firstEOA);
    const secondEOABefore = await getBalance(secondEOA);

    const payout = parseEther("0.01");
    // Transfer the funds
    const tx = await BasicFeeHandlerInstance.write.transferFee([
      [firstEOA.account!.address, secondEOA.account!.address],
      [payout, payout]
    ]);

    await expect(tx).to.emit(BasicFeeHandlerInstance, "FeeDistributed").withArgs(
      zeroAddress,
      recipient,
      payout
    );

    const firstEOABalanceAfter = await getBalance(firstEOA);
    const secondEOABalanceAfter = await getBalance(secondEOA);
    assert.equal(firstEOABalanceAfter, firstEOABefore + payout);
    assert.equal(secondEOABalanceAfter, secondEOABefore + payout);
  });

  it("should require admin role to distribute fee", async () => {
    await BridgeInstance.write.adminChangeFeeHandler([BasicFeeHandlerInstance.address]);
    await BasicFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);

    await NativeTokenTransferGatewayInstance.write.deposit([
      destinationDomainID,
      btcrecipient
    ],
      {
         account: depositor.account,
        value: depositAmount
      }
    );

    assert.equal(
      await getBalance(NativeTokenTransferGatewayInstance),
      BigInt(0)
    );
    assert.equal(
      await getBalance(NativeTokenHandlerInstance),
      BigInt(formatUnits(transferredAmount, tokenDecimals))
    );

    const payout = parseEther("0.01");
    await expect(
      BasicFeeHandlerInstance.write.transferFee([
      [firstEOA.account!.address, secondEOA.account!.address],
      [payout, payout]
    ], {account: nonAdmin.account}),
  ).to.be.revertedWith("sender doesn't have admin role");
  });

  it("should revert if addrs and amounts arrays have different length", async () => {
    await BridgeInstance.write.adminChangeFeeHandler([BasicFeeHandlerInstance.address]);
    await BasicFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);

    await NativeTokenTransferGatewayInstance.write.deposit([
      destinationDomainID,
      btcrecipient
    ],
      {
         account: depositor.account,
        value: depositAmount
      }
    );

    assert.equal(
      await getBalance(NativeTokenTransferGatewayInstance),
      BigInt(0)
    );
    assert.equal(
      await getBalance(NativeTokenHandlerInstance),
      BigInt(formatUnits(transferredAmount, tokenDecimals))
    );

    const payout = parseEther("0.01");
    await expect(
      BasicFeeHandlerInstance.write.transferFee([
        [firstEOA.account!.address, secondEOA.account!.address],
        [payout, payout, payout]
      ])
    ).to.be.revertedWith("addrs[], amounts[]: diff length");
  });
});
