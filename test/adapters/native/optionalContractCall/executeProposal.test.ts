// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {concat, encodeAbiParameters, encodeFunctionData, Hex, keccak256, parseAbiParameters, parseEther, parseUnits, toFunctionSelector, toHex, WalletClient, zeroAddress} from "viem";
import {createBtcDepositData, createGmpDepositData, createMessageCallData, createOptionalContractCallDepositData, createResourceID, deploySourceChainContracts, getBalance, mockSignTypedProposalWithInvalidChainID, mpcAddress, signTypedProposal, trimPrefix} from "../../../helpers";
import {ContractTypesMap} from 'hardhat/types';
import {loadFixture} from '@nomicfoundation/hardhat-network-helpers';
import {assert, expect} from 'chai';
import {Proposal} from '../../../../types';


describe("Bridge - [execute proposal - native token]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;

  const expectedDepositNonce = BigInt(1);
  const emptySetResourceData = "0x";
  const resourceID = toHex(650, {size:32});
  const depositAmount = parseEther("1");
  const fee = parseEther("0.1");
  const transferredAmount = depositAmount - fee;
  const transactionId = toHex(1, {size:32});
  const executionGasAmount = BigInt(30000000);
  const amountToMint = BigInt(20);

  let BridgeInstance: ContractTypesMap["Bridge"];
  let DefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];
  let NativeTokenHandlerInstance: ContractTypesMap["NativeTokenHandler"];
  let BasicFeeHandlerInstance: ContractTypesMap["BasicFeeHandler"];
  let FeeHandlerRouterInstance: ContractTypesMap["FeeHandlerRouter"];
  let NativeTokenTransferGatewayInstance: ContractTypesMap["NativeTokenTransferGateway"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];

  let depositor: WalletClient;
  let recipient: WalletClient;
  let relayer1: WalletClient;
  let firstEOA: WalletClient;
  let seconEOA: WalletClient;

  let proposal: Proposal;
  let depositProposalData: Hex;
  let dataHash: Hex;
  let message: Hex;

  before(async () => {
    ({
      BridgeInstance,
      ERC20MintableInstance,
      BasicFeeHandlerInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      depositor,
      recipient,
      relayer1,
      firstEOA,
      seconEOA,
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
      args: [recipient, "5"]
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

    dataHash = keccak256(
      concat([
        NativeTokenHandlerInstance.address,
        trimPrefix(depositProposalData)
      ])
    );

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("isProposalExecuted returns false if depositNonce is not used", async () => {
    const destinationDomainID = await BridgeInstance.read._domainID();

    assert.isFalse(
      await BridgeInstance.read.isProposalExecuted([
        destinationDomainID,
        expectedDepositNonce
      ])
    );
  });

  it("should create and execute executeProposal with contract call successfully", async () => {
    const proposalSignedData = await signTypedProposal(
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

    const recipientNativeBalanceBefore = await getBalance(recipient);
    const recipientERC20BalanceBefore = await ERC20MintableInstance.read.balanceOf([recipient]);
    const defaultReceiverBalanceBefore = await getBalance(DefaultMessageReceiverInstance.address);

    await expect(
      BridgeInstance.write.executeProposal([proposal, proposalSignedData], {
        account: relayer1.account,
        gas: executionGasAmount
      })
    ).not.to.be.reverted;

    // check that deposit nonce has been marked as used in bitmap
    assert.isTrue(
      await BridgeInstance.read.isProposalExecuted([
        originDomainID,
        expectedDepositNonce
      ])
    );

    // check that tokens are transferred to recipient address
    const recipientNativeBalanceAfter = await getBalance(recipient);
    const recipientERC20BalanceAfter = await ERC20MintableInstance.read.balanceOf([recipient.account!.address]);
    const defaultReceiverBalanceAfter = await getBalance(DefaultMessageReceiverInstance.address);

    assert.strictEqual(
      recipientNativeBalanceBefore + transferredAmount,
      recipientNativeBalanceAfter
    );
    assert.strictEqual(
      recipientERC20BalanceBefore + amountToMint,
      recipientERC20BalanceAfter
    );
    assert.strictEqual(defaultReceiverBalanceBefore, defaultReceiverBalanceAfter);
  });

  it("should skip executing proposal if deposit nonce is already used", async () => {
    const proposalSignedData = await signTypedProposal(
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
    );

    await expect(
      BridgeInstance.write.executeProposal([proposal, proposalSignedData], {
        account: relayer1.account,
        gas: executionGasAmount
      })
    ).not.to.be.reverted;

    const skipExecuteTx = await BridgeInstance.write.executeProposal([
      proposal,
      proposalSignedData],
      {
        account: relayer1.account,
        gas: executionGasAmount
      }
    );

    // check that no ProposalExecution events are emitted
    await expect(skipExecuteTx).not.to.emit(BridgeInstance, "ProposalExecution");
  });

  it("executeProposal event should be emitted with expected values", async () => {
    const proposalSignedData = await signTypedProposal(
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

    const recipientBalanceBefore = await getBalance(recipient);

    const proposalTx = await BridgeInstance.write.executeProposal([
      proposal,
      proposalSignedData],
      {
        account: relayer1.account,
        gas: executionGasAmount
      }
    );

    await expect(proposalTx).to.emit(BridgeInstance, "ProposalExecution").withArgs(
      originDomainID,
      expectedDepositNonce,
      dataHash,
      encodeAbiParameters(
        parseAbiParameters(["address", "address", "uint256"]),
        [zeroAddress, DefaultMessageReceiverInstance.address, transferredAmount]
      )
    )

    // check that deposit nonce has been marked as used in bitmap
    assert.isTrue(
      await BridgeInstance.read.isProposalExecuted([
        originDomainID,
        expectedDepositNonce
      ])
    );

    // check that tokens are transferred to recipient address
    const recipientBalanceAfter = await getBalance(recipient);
    assert.strictEqual(recipientBalanceBefore + transferredAmount, recipientBalanceAfter);
  });

  it(`should fail to executeProposal if signed Proposal has different
    chainID than the one on which it should be executed`, async () => {
    const proposalSignedData =
      await mockSignTypedProposalWithInvalidChainID(
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

    await expect(
      BridgeInstance.write.executeProposal([proposal, proposalSignedData], {
        account: relayer1.account,
      }),
    ).to.be.revertedWithCustomError(BridgeInstance, "InvalidProposalSigner()");
  });

  it("should revert if handler does not have SYGMA_HANDLER_ROLE", async () => {
    await DefaultMessageReceiverInstance.write.revokeRole([
      await DefaultMessageReceiverInstance.read.SYGMA_HANDLER_ROLE(),
      NativeTokenHandlerInstance.address
    ]);
    const proposalSignedData = await signTypedProposal(
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
    const proposalSignedData = await signTypedProposal(
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
        account: depositor.account,
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
});
