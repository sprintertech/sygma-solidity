import hre from 'hardhat';
// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import {assert, expect} from "chai";
import {concat, encodeAbiParameters, Hex, keccak256, parseAbiParameters, parseEther, toHex, WalletClient} from "viem";
import {createERCDepositData, deploySourceChainContracts, getBalance, mockSignTypedProposalWithInvalidChainID, mpcAddress, trimPrefix} from "../../helpers";
import {ContractTypesMap} from "hardhat/types";
import {loadFixture} from '@nomicfoundation/hardhat-network-helpers';
import {Proposal} from '../../../types';

describe("Bridge - [execute proposal - native token]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;

  const expectedDepositNonce = BigInt(1);
  const emptySetResourceData = "0x";
  const resourceID = toHex(650, {size:32});
  const btcrecipient = "bc1qs0fcdq73vgurej48yhtupzcv83un2p5qhsje7n";
  const depositAmount = parseEther("1");
  const fee = parseEther("0.1");
  const transferredAmount = depositAmount - fee;

  let BridgeInstance: ContractTypesMap["Bridge"];
  let NativeTokenHandlerInstance: ContractTypesMap["NativeTokenHandler"];
  let BasicFeeHandlerInstance: ContractTypesMap["BasicFeeHandler"];
  let FeeHandlerRouterInstance: ContractTypesMap["FeeHandlerRouter"];
  let NativeTokenTransferGatewayInstance: ContractTypesMap["NativeTokenTransferGateway"];

  let depositor: WalletClient;
  let recipient: WalletClient;
  let relayer1: WalletClient;

  let proposal: Proposal;
  let depositProposalData;
  let dataHash: Hex;

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
      depositor,
      recipient,
      relayer1
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
      originDomainID,
      resourceID,
      BasicFeeHandlerInstance.address
    ]);

    depositProposalData = createERCDepositData(
      transferredAmount,
      20,
      recipient
    );

    proposal = {
      originDomainID: originDomainID,
      depositNonce: expectedDepositNonce,
      resourceID: resourceID,
      data: depositProposalData,
    };

    dataHash = keccak256(
      concat([
        NativeTokenHandlerInstance.address,
        trimPrefix(depositProposalData)
      ])
    );

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);

    // send ETH to destination adapter for transfers
    await depositor.sendTransaction({
       account: depositor.account!.address,
      to: NativeTokenHandlerInstance.address,
      value: BigInt(1000000000000000000),
      chain: null
    })
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

  it("should create and execute executeProposal successfully", async () => {
    const proposalSignedData = signTypedProposal(
      BridgeInstance.address,
      [proposal]
    );

    // depositor makes initial deposit of depositAmount
    assert.isFalse(await BridgeInstance.read.paused());
    await expect(
      NativeTokenTransferGatewayInstance.write.deposit([originDomainID, btcrecipient],
      {
         account: depositor.account,
        value: depositAmount
      })
    ).not.to.be.reverted;

    const recipientBalanceBefore = await getBalance(recipient);

    await expect(
      BridgeInstance.write.executeProposal([proposal, proposalSignedData],
      {
        account: relayer1.account,
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
    const recipientBalanceAfter = await getBalance(recipient);
    assert.strictEqual(transferredAmount + recipientBalanceBefore, recipientBalanceAfter);
  });

  it("should skip executing proposal if deposit nonce is already used", async () => {
    const proposalSignedData = signTypedProposal(
      BridgeInstance.address,
      [proposal]
    );

    // depositor makes initial deposit of depositAmount
    assert.isFalse(await BridgeInstance.read.paused());
    await expect(
      NativeTokenTransferGatewayInstance.write.deposit([originDomainID, btcrecipient],
      {
         account: depositor.account,
        value: depositAmount
      })
    ).not.to.be.reverted;

    await expect(
      BridgeInstance.write.executeProposal([proposal, proposalSignedData],
      {
        account: relayer1.account,
      })
    ).not.to.be.reverted;

    const skipExecuteTx = await BridgeInstance.write.executeProposal([
      proposal,
      proposalSignedData
    ],
      {
        account: relayer1.account
      }
    );

    // check that no ProposalExecution events are emitted
    await expect(skipExecuteTx).not.to.emit(BridgeInstance, "ProposalExecution");
  });

  it("executeProposal event should be emitted with expected values", async () => {
    const proposalSignedData = signTypedProposal(
      BridgeInstance.address,
      [proposal]
    );

    // depositor makes initial deposit of depositAmount
    assert.isFalse(await BridgeInstance.read.paused());
    await expect(
      NativeTokenTransferGatewayInstance.write.deposit([originDomainID, btcrecipient],
      {
         account: depositor.account,
        value: depositAmount
      })
    );

    const recipientBalanceBefore = await getBalance(recipient);

    const proposalTx = await BridgeInstance.write.executeProposal([
      proposal,
      proposalSignedData
    ],
      {
        account: relayer1.account
      }
    );

    await expect(proposalTx).to.emit(BridgeInstance, "ProposalExecution").withArgs(
      originDomainID,
      expectedDepositNonce,
      dataHash,
      encodeAbiParameters(
        parseAbiParameters(["address", "address", "uint256"]),
        [NativeTokenHandlerInstance.address, recipient.account!.address, transferredAmount]
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
    assert.strictEqual(transferredAmount + recipientBalanceBefore, recipientBalanceAfter);
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
      NativeTokenTransferGatewayInstance.write.deposit([originDomainID, btcrecipient],
      {
         account: depositor.account,
        value: depositAmount
      })
    );

    await expect(
      BridgeInstance.write.executeProposal([proposal, proposalSignedData],
        {
          account: relayer1.account,
        }
      ),
    ).to.be.revertedWithCustomError(BridgeInstance, "InvalidProposalSigner()");
  });
});
