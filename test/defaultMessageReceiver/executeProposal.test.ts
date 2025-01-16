// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {ContractTypesMap} from "hardhat/types";
import {encodeFunctionData, Hex, parseEther, toHex, WalletClient, zeroAddress} from "viem";
import {createMessageCallData, createMessageCallData, createOptionalContractCallDepositData, deploySourceChainContracts, mpcAddress} from "../helpers";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {assert, expect} from 'chai';
import {Action, Proposal} from '../../types';


describe("Bridge - [execute proposal - native token]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;

  const expectedDepositNonce = BigInt(1);
  const emptySetResourceData = "0x";
  const resourceID = toHex(650, {size:32});
  const depositAmount = parseEther("1");
  const fee = parseEther("0.1");
  const transferredAmount = depositAmount - fee;
  const transactionId = toHex(11, {size:32});
  const executionGasAmount = BigInt(30000000);

  let BridgeInstance: ContractTypesMap["Bridge"];
  let DefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];
  let NativeTokenHandlerInstance: ContractTypesMap["NativeTokenHandler"];
  let BasicFeeHandlerInstance: ContractTypesMap["BasicFeeHandler"];
  let FeeHandlerRouterInstance: ContractTypesMap["FeeHandlerRouter"];
  let NativeTokenTransferGatewayInstance: ContractTypesMap["NativeTokenTransferGateway"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];

  let admin: WalletClient;
  let depositor: WalletClient;
  let recipient: WalletClient;
  let relayer1: WalletClient;

  let proposal: Proposal;
  let depositProposalData: Hex;
  let message: Hex;

  beforeEach(async () => {
    ({
      DefaultMessageReceiverInstance,
      BridgeInstance,
      NativeTokenHandlerInstance,
      BasicFeeHandlerInstance,
      FeeHandlerRouterInstance,
      NativeTokenTransferGatewayInstance,
      ERC20MintableInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      admin,
      depositor,
      recipient,
      relayer1,
    ] = await hre.viem.getWalletClients();

    await DefaultMessageReceiverInstance.write.grantRole([
      await DefaultMessageReceiverInstance.read.SYGMA_HANDLER_ROLE(),
      NativeTokenHandlerInstance.address
    ]);

    await BridgeInstance.write.adminSetResource([
        NativeTokenHandlerInstance.address,
        resourceID,
        zeroAddress,
        emptySetResourceData
      ]);
    await BasicFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);
    await BridgeInstance.write.adminChangeFeeHandler([FeeHandlerRouterInstance.address]);
    await FeeHandlerRouterInstance.write.adminSetResourceHandler([
      originDomainID,
      resourceID,
      BasicFeeHandlerInstance.address
    ]);

    await ERC20MintableInstance.write.grantRole([
      await ERC20MintableInstance.read.MINTER_ROLE(),
      DefaultMessageReceiverInstance.address
    ]);

    const actionData = encodeFunctionData({
      abi: ["function mint(address to, uint256 amount)"],
      functionName: "mint",
      args: [recipient, "20"]
    });

    const actions = [{
      nativeValue: BigInt(0),
      callTo: ERC20MintableInstance.address,
      approveTo: zeroAddress,
      tokenSend: zeroAddress,
      tokenReceive: zeroAddress,
      data: actionData,
    }]
    message = createMessageCallData(
      transactionId,
      actions,
      recipient.account!.address
    );

    depositProposalData = createOptionalContractCallDepositData(
      transferredAmount,
      zeroAddress,
      executionGasAmount,
      message
    );

    proposal = {
      originDomainID: originDomainID,
      depositNonce: expectedDepositNonce,
      resourceID: resourceID,
      data: depositProposalData
    };

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("should revert if handler does not have SYGMA_HANDLER_ROLE", async () => {
    await DefaultMessageReceiverInstance.write.revokeRole([
      await DefaultMessageReceiverInstance.read.SYGMA_HANDLER_ROLE(),
      NativeTokenHandlerInstance.address
    ]);
    const proposalSignedData = signTypedProposal(
      BridgeInstance.address,
      [proposal]
    );

    // depositor makes initial deposit of depositAmount
    assert.isFalse(await BridgeInstance.read.paused());
    await expect(
      NativeTokenTransferGatewayInstance.write.depositToEVMWithMessage([
        originDomainID,
        zeroAddress,
        executionGasAmount,
        message],
      {
        account: depositor.account,
        value: depositAmount
      })
    ).not.to.be.reverted;

    const executeTx = await BridgeInstance.write.executeProposal([
      proposal,
      proposalSignedData],
      {
        account: relayer1.account,
        gas: executionGasAmount
      }
    );

    await expect(executeTx).to.emit(BridgeInstance, "FailedHandlerExecution").withArgs(
      originDomainID,
      expectedDepositNonce,
      "0xdeda9030" // InsufficientPermission()
    );
  });

  it("should revert if insufficient gas limit left for executing action", async () => {
    const insufficientExecutionGasAmount = BigInt(100000);
    const proposalSignedData = signTypedProposal(
      BridgeInstance.address,
      [proposal]
    );

    // depositor makes initial deposit of depositAmount
    assert.isFalse(await BridgeInstance.read.paused());
    await expect(
      NativeTokenTransferGatewayInstance.write.depositToEVMWithMessage([
        originDomainID,
        zeroAddress,
        insufficientExecutionGasAmount,
        message],
      {
        from: depositor,
        value: depositAmount
      })
    ).not.to.be.reverted;

      const executeTx = await BridgeInstance.write.executeProposal([
        proposal,
        proposalSignedData],
        {
          account: relayer1.account,
          gas: insufficientExecutionGasAmount
        }
      );

      await expect(executeTx).to.emit(BridgeInstance, "FailedHandlerExecution").withArgs(
        originDomainID,
        expectedDepositNonce,
        "0x60ee1247" // InsufficientGasLimit()
      );
  });

  it("should fail to transfer funds if invalid message is provided", async () => {
    const actionData = encodeFunctionData({
      abi: ["function mint(address to, uint256 amount)"],
      functionName: "mint",
      args: [recipient.account!.address, "20"]
    });

    const actions = [{
      nativeValue: BigInt(0),
      callTo: zeroAddress,
      approveTo: zeroAddress,
      tokenSend: zeroAddress,
      tokenReceive: zeroAddress,
      data: actionData
    }]
    const message = createMessageCallData(
      transactionId,
      actions,
      recipient.account!.address
    );

    const depositProposalData = createOptionalContractCallDepositData(
      transferredAmount,
      zeroAddress,
      executionGasAmount,
      message
    );

    const proposal = {
      originDomainID: originDomainID,
      depositNonce: expectedDepositNonce,
      resourceID: resourceID,
      data: depositProposalData
    };
    const proposalSignedData = signTypedProposal(
      BridgeInstance.address,
      [proposal]
    );

    const executeTx = await BridgeInstance.write.executeProposal([
      proposal,
      proposalSignedData],
      {
        account: relayer1.account,
        gas: executionGasAmount
      }
    );


    await expect(executeTx).to.emit(BridgeInstance, "FailedHandlerExecution").withArgs(
      originDomainID,
      expectedDepositNonce,
      "0x2ed7fc0e" // FailedFundsTransfer()
    );
  });
});
