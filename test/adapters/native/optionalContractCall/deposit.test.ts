// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {concat, encodeAbiParameters, encodeFunctionData, Hex, keccak256, parseAbiParameters, parseEther, parseUnits, toFunctionSelector, toHex, WalletClient, zeroAddress} from "viem";
import {createBtcDepositData, createGmpDepositData, createMessageCallData, createOptionalContractCallDepositData, createResourceID, deploySourceChainContracts, mpcAddress, trimPrefix} from "../../../helpers";
import {ContractTypesMap} from 'hardhat/types';
import {loadFixture} from '@nomicfoundation/hardhat-network-helpers';
import {assert, expect} from 'chai';
import {Wallet} from 'ethers';
import {Proposal} from '../../../../types';


describe("Bridge - [deposit - native token]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;
  const expectedDepositNonce = BigInt(1);
  const emptySetResourceData = "0x";
  const resourceID = toHex(650, {size:32});
  const btcrecipient = "bc1qs0fcdq73vgurej48yhtupzcv83un2p5qhsje7n";
  const depositAmount = parseEther("1");
  const fee = parseEther("0.1");
  const transferredAmount = depositAmount - fee;
  const transactionId = toHex(1, {size:32});
  const executionGasAmount = BigInt(30000000);

  let BridgeInstance: ContractTypesMap["Bridge"];
  let DefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];
  let NativeTokenHandlerInstance: ContractTypesMap["NativeTokenHandler"];
  let BasicFeeHandlerInstance: ContractTypesMap["BasicFeeHandler"];
  let FeeHandlerRouterInstance: ContractTypesMap["FeeHandlerRouter"];
  let NativeTokenTransferGatewayInstance: ContractTypesMap["NativeTokenTransferGateway"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];

  let depositor: WalletClient;
  let evmRecipient: WalletClient;
  let invalidAdapterMock: WalletClient;

  let message: Hex;


  before(async () => {
    ({
      DefaultMessageReceiverInstance,
      BridgeInstance,
      ERC20MintableInstance,
      BasicFeeHandlerInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      depositor,
      evmRecipient,
      invalidAdapterMock
    ] = await hre.viem.getWalletClients();

    await BridgeInstance.write.adminSetResource([
      NativeTokenHandlerInstance.address,
      resourceID,
      NativeTokenHandlerInstance.address,
      emptySetResourceData
    ]);
    await BasicFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);
    await BridgeInstance.write.adminChangeFeeHandler([FeeHandlerRouterInstance.address]);
    await FeeHandlerRouterInstance.write.adminSetResourceHandler([
      destinationDomainID,
      resourceID,
      BasicFeeHandlerInstance.address
    ]);

    const actionData = encodeFunctionData({
      abi: ["function mint(address to, uint256 amount)"],
      functionName: "mint",
      args: [evmRecipient, "5"]
    });

    const actions = [{
      nativeValue: BigInt(0),
      callTo: ERC20MintableInstance.address,
      approveTo: zeroAddress,
      tokenSend: zeroAddress,
      tokenReceive: zeroAddress,
      data: actionData,
    }];
    message = createMessageCallData(
      transactionId,
      actions,
      DefaultMessageReceiverInstance.address
    );

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

  it("Native token deposit to EVM can be made", async () => {
    await expect(
      await NativeTokenTransferGatewayInstance.write.depositToEVM([
        destinationDomainID,
        evmRecipient.account!.address
      ],
        {
          account: depositor.account,
          value: depositAmount,
        }
      )
    ).not.to.be.reverted;
  });

  it("Native token deposit to EVM with message can be made", async () => {
    await expect(
      await NativeTokenTransferGatewayInstance.write.depositToEVMWithMessage([
        destinationDomainID,
        zeroAddress,
        executionGasAmount,
        message],
        {
          account: depositor.account,
          value: depositAmount,
        }
      )
    ).not.to.be.reverted;
  });

  it("Native token general deposit can be made", async () => {
    const addressLength = BigInt(20);
    const depositData = encodeAbiParameters(
      parseAbiParameters(["uint256", "address"]),
      [addressLength, evmRecipient.account!.address]
    );
    await expect(
      await NativeTokenTransferGatewayInstance.write.depositGeneral([
        destinationDomainID,
        depositData],
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
      btcrecipient],
      {
        account: depositor.account,
        value: depositAmount,
      }
    );

    const depositCount = await BridgeInstance.read._depositCounts([
      destinationDomainID
    ]);
    assert.strictEqual(depositCount, expectedDepositNonce);
  });

  it("Deposit event is fired with expected value", async () => {
    const depositTx = await NativeTokenTransferGatewayInstance.write.deposit([
      destinationDomainID,
      btcrecipient],
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
    );
  });

  it("Should revert if destination domain is current bridge domain", async () => {
    await expect(
      NativeTokenTransferGatewayInstance.write.deposit([originDomainID, btcrecipient], {
        account: depositor.account,
        value: depositAmount
      })
    ).to.be.reverted;
  });

  it("Should revert if sender is not native token adapter", async () => {
    const NativeTokenHandlerInstance = await hre.viem.deployContract("NativeTokenHandler", [
      BridgeInstance.address,
      invalidAdapterMock.account!.address,
      DefaultMessageReceiverInstance.address
    ]);


    await BridgeInstance.write.adminSetResource([
      NativeTokenHandlerInstance.address,
      resourceID,
      NativeTokenHandlerInstance.address,
      emptySetResourceData
    ]);

    await expect(
      NativeTokenTransferGatewayInstance.write.deposit([destinationDomainID, btcrecipient], {
        account: depositor.account,
        value: depositAmount
      })
    ).to.be.reverted;
  });

  it("Should revert if execution gas provided is 0", async () => {
    const invalidExecutionGasAmount = BigInt(0);
    await expect(
      NativeTokenTransferGatewayInstance.write.depositToEVMWithMessage([
        destinationDomainID,
        zeroAddress,
        invalidExecutionGasAmount,
        message],
        {
          account: depositor.account,
          value: depositAmount,
        }
      ),
    ).to.be.revertedWithCustomError(NativeTokenHandlerInstance, "ZeroGas()");
  });

  it("Should revert if msg.value is 0", async () => {
    await expect(
      NativeTokenTransferGatewayInstance.write.depositToEVMWithMessage([
        destinationDomainID,
        zeroAddress,
        executionGasAmount,
        message],
        {
          account: depositor.account,
        }
      ),
    ).to.be.revertedWithCustomError(NativeTokenHandlerInstance, "InsufficientMsgValueAmount(uint256)");
  });
});
