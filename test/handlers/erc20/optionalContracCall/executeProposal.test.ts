// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {concat, encodeAbiParameters, encodeFunctionData, Hex, keccak256, parseAbiParameters, parseUnits, toFunctionSelector, toHex, WalletClient, zeroAddress} from "viem";
import {createGmpDepositData, createMessageCallData, createOptionalContractCallDepositData, createResourceID, deploySourceChainContracts, getBalance, mockSignTypedProposalWithInvalidChainID, mpcAddress, signTypedProposal, trimPrefix} from "../../../helpers";
import {ContractTypesMap} from 'hardhat/types';
import {loadFixture} from '@nomicfoundation/hardhat-network-helpers';
import {assert, expect} from 'chai';
import {Wallet} from 'ethers';
import {Proposal} from '../../../../types';

describe("Bridge - [execute proposal - erc20 token with contract call]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;

  const expectedDepositNonce = BigInt(1);
  const emptySetResourceData = "0x";
  const resourceID = toHex(650, {size:32});
  const initialTokenAmount = BigInt(100);
  const depositAmount = BigInt(10);
  const fee = BigInt(1000000); // BPS
  const transferredAmount = BigInt(9);
  const transactionId = toHex(1, {size:32});
  const executionGasAmount = BigInt(30000000);
  const feeData = "0x";
  const amountToMint = BigInt(1);
  const returnBytesLength = 128;

  let DefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"]
  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];
  let ERC20HandlerInstance: ContractTypesMap["ERC20Handler"];
  let ERC721MintableInstance: ContractTypesMap["ERC721MinterBurnerPauser"];
  let FeeHandlerRouterInstance: ContractTypesMap["FeeHandlerRouter"];
  let PercentageFeeHandlerInstance: ContractTypesMap["PercentageERC20FeeHandler"];

  let depositor: WalletClient;
  let evmRecipient: WalletClient;
  let relayer1: WalletClient;

  let dataHash: Hex;
  let message: Hex;
  let depositProposalData: Hex;
  let proposal: Proposal;

  before(async () => {
    ({
      DefaultMessageReceiverInstance,
      BridgeInstance,
      ERC20MintableInstance,
      ERC20HandlerInstance,
      ERC721MintableInstance,
      PercentageFeeHandlerInstance
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      depositor,
      evmRecipient,
      relayer1,
    ] = await hre.viem.getWalletClients();

    await ERC20MintableInstance.write.mint([depositor.account!.address, initialTokenAmount]);

    await BridgeInstance.write.adminSetResource([
      ERC20HandlerInstance.address,
      resourceID,
      ERC20MintableInstance.address,
      emptySetResourceData
    ]);

    await ERC20MintableInstance.write.approve([
      ERC20HandlerInstance.address,
      depositAmount
    ],
      {
        account: depositor.account
      }
    );

    await PercentageFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);
    await PercentageFeeHandlerInstance.write.changeFeeBounds([resourceID, BigInt(2), BigInt(10)]);
    await BridgeInstance.write.adminChangeFeeHandler([FeeHandlerRouterInstance.address]);
    await FeeHandlerRouterInstance.write.adminSetResourceHandler([
      destinationDomainID,
      resourceID,
      PercentageFeeHandlerInstance.address
    ]);
    await DefaultMessageReceiverInstance.write.grantRole([
      await DefaultMessageReceiverInstance.read.SYGMA_HANDLER_ROLE(),
      ERC20HandlerInstance.address
    ]);
    await ERC721MintableInstance.write.grantRole([
      await ERC721MintableInstance.read.MINTER_ROLE(),
      DefaultMessageReceiverInstance.address
    ]);
    await ERC20MintableInstance.write.approve([
      ERC20HandlerInstance.address,
      depositAmount
    ],
      {
        account: depositor.account
      }
    );

    const actionData = encodeFunctionData({
      abi: ["function mint(address to, uint256 tokenId, string memory _data)"],
      functionName: "mint",
      args: [evmRecipient, "5", ""]
    });
    const actions = [{
      nativeValue: 0,
      callTo: ERC721MintableInstance.address,
      approveTo: zeroAddress,
      tokenSend: zeroAddress,
      tokenReceive: zeroAddress,
      data: actionData,
    }]
    message = createMessageCallData(
      transactionId,
      actions,
      evmRecipient
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
        ERC20HandlerInstance.address,
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
      BridgeInstance.write.deposit([
        destinationDomainID,
        resourceID,
        depositProposalData,
        feeData
      ],
        {
          account: depositor.account
      })
    ).not.to.be.reverted;

    const recipientNativeBalanceBefore = await getBalance(evmRecipient);
    const recipientERC721BalanceBefore = await ERC721MintableInstance.read.balanceOf([evmRecipient.account!.address]);
    const defaultReceiverBalanceBefore = await getBalance(DefaultMessageReceiverInstance);

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
    const recipientNativeBalanceAfter = await getBalance(evmRecipient);
    const recipientERC721BalanceAfter = await ERC721MintableInstance.read.balanceOf([evmRecipient.account!.address]);
    const defaultReceiverBalanceAfter = await getBalance(DefaultMessageReceiverInstance);

    assert.strictEqual(
      recipientNativeBalanceBefore,
      recipientNativeBalanceAfter
    );
    assert.strictEqual(recipientERC721BalanceBefore + amountToMint, recipientERC721BalanceAfter);
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
      BridgeInstance.write.deposit([
        destinationDomainID,
        resourceID,
        depositProposalData,
        feeData
      ],
      {
        account: depositor.account
      })
    ).not.to.be.reverted;

    await expect(
      BridgeInstance.write.executeProposal([proposal, proposalSignedData], {
        account: relayer1.account,
        gas: executionGasAmount
      })
    ).not.to.be.reverted;

    const skipExecuteTx = await BridgeInstance.write.executeProposal([
      proposal,
      proposalSignedData
    ],
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
      BridgeInstance.write.deposit([
        destinationDomainID,
        resourceID,
        depositProposalData,
        feeData
      ],
      {
        account: depositor.account
      })
    ).not.to.be.reverted;

    const recipientBalanceBefore = await ERC20MintableInstance.read.balanceOf([evmRecipient.account!.address]);

    const proposalTx = await BridgeInstance.write.executeProposal([
      proposal,
      proposalSignedData
    ],
      {
        account: relayer1.account,
        gas: executionGasAmount
      }
    );


    const expectedHandlerResponse = encodeAbiParameters(
      parseAbiParameters(
        ["address", "address", "uint256", "uint16", "uint256"]
      ),
      [
        ERC20MintableInstance.address,
        DefaultMessageReceiverInstance.address,
        transferredAmount,
        returnBytesLength,
        BigInt(0)
      ]
    );

    await expect(proposalTx).to.emit(BridgeInstance, "ProposalExecution").withArgs(
      originDomainID,
      expectedDepositNonce,
      dataHash,
      expectedHandlerResponse
    );

    // check that deposit nonce has been marked as used in bitmap
    assert.isTrue(
      await BridgeInstance.read.isProposalExecuted([
        originDomainID,
        expectedDepositNonce
      ])
    );

    // check that ERC20 tokens are transferred to recipient address
    const recipientBalanceAfter = await ERC20MintableInstance.read.balanceOf([evmRecipient.account!.address]);
    assert.strictEqual(recipientBalanceBefore + transferredAmount,
      recipientBalanceAfter
    );
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
      BridgeInstance.write.deposit([
        destinationDomainID,
        resourceID,
        depositProposalData,
        feeData
      ],
      {
        account: depositor.account
      })
    ).not.to.be.reverted;

    await expect(
      BridgeInstance.write.executeProposal([proposal, proposalSignedData], {
        account: relayer1.account,
      }),
    ).to.be.revertedWithCustomError(BridgeInstance, "InvalidProposalSigner()");
  });
});
