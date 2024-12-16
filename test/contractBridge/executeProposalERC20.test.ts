import hre from 'hardhat';
// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import {concat, encodeAbiParameters, Hex, keccak256, parseAbiParameters, WalletClient} from "viem";
import {createERCDepositData, createResourceID, deploySourceChainContracts, mockSignTypedProposalWithInvalidChainID, mpcAddress, signTypedProposal, trimPrefix} from "../helpers";
import {ContractTypesMap} from "hardhat/types";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {assert, expect} from 'chai';
import {Proposal} from '../../types';


describe("Bridge - [execute proposal - ERC20]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;

  const initialTokenAmount = BigInt(100);
  const depositAmount = BigInt(10);
  const expectedDepositNonce = BigInt(1);
  const feeData = "0x";
  const emptySetResourceData = "0x";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];
  let ERC20HandlerInstance: ContractTypesMap["ERC20Handler"];

  let depositor: WalletClient;
  let recipient: WalletClient;
  let relayer1: WalletClient;

  let resourceID: Hex;
  let depositData: Hex;

  let dataHash = "";
  let proposal: Proposal;

  before(async () => {
    ({
      BridgeInstance,
      ERC20HandlerInstance,
      ERC20MintableInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      depositor,
      recipient,
      relayer1
    ] = await hre.viem.getWalletClients();

    resourceID = createResourceID(
      ERC20MintableInstance.address,
      destinationDomainID
    );

    await ERC20MintableInstance.write.mint([depositor.account!.address, initialTokenAmount]);
    await BridgeInstance.write.adminSetResource([
      ERC20HandlerInstance.address,
      resourceID,
      ERC20MintableInstance.address,
      emptySetResourceData
    ]);

    depositData = createERCDepositData(depositAmount, 20, recipient.account!.address);
    dataHash = keccak256(
      concat([
        ERC20HandlerInstance.address,
        trimPrefix(depositData)
      ])
    );

    await ERC20MintableInstance.write.approve([
      ERC20HandlerInstance.address,
      depositAmount
    ],
      {
        account: depositor.account
      }
    );

    proposal = {
      originDomainID: originDomainID,
      depositNonce: expectedDepositNonce,
      resourceID: resourceID,
      data: depositData,
    };

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

  it("should create and execute executeProposal successfully", async () => {
    const proposalSignedData = await signTypedProposal(
      BridgeInstance.address,
      [proposal]
    );

    // depositor makes initial deposit of depositAmount
    assert.isFalse(await BridgeInstance.read.paused());
    await expect(
      BridgeInstance.write.deposit([
        originDomainID,
        resourceID,
        depositData,
        feeData
      ], {
        account: depositor.account,
      })
    ).not.to.be.reverted;

    await expect(
      BridgeInstance.write.executeProposal([
        proposal,
        proposalSignedData
      ],
        {
          account: relayer1.account,
        }
      )
    ).not.to.be.reverted;

    // check that deposit nonce has been marked as used in bitmap
    assert.isTrue(
      await BridgeInstance.read.isProposalExecuted([
        originDomainID,
        expectedDepositNonce
      ])
    );

    // check that tokens are transferred to recipient address
    const recipientBalance = await ERC20MintableInstance.read.balanceOf([
      recipient.account!.address
    ]);
    assert.strictEqual(recipientBalance, depositAmount);
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
        originDomainID,
        resourceID,
        depositData,
        feeData
      ],
        {
          account: depositor.account,
        }
      )
    ).not.to.be.reverted;

    await expect(
      BridgeInstance.write.executeProposal([
        proposal,
        proposalSignedData
      ],
        {
          account: relayer1.account,
        }
      )
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
    const proposalSignedData = await signTypedProposal(
      BridgeInstance.address,
      [proposal]
    );

    // depositor makes initial deposit of depositAmount
    assert.isFalse(await BridgeInstance.read.paused());
    await expect(
      BridgeInstance.write.deposit([
        originDomainID,
        resourceID,
        depositData,
        feeData
      ],
        {
          account: depositor.account,
        }
      )
    ).not.to.be.reverted;

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
        [ERC20MintableInstance.address, recipient.account!.address, depositAmount]
      )
    );

    // check that deposit nonce has been marked as used in bitmap
    assert.isTrue(
      await BridgeInstance.read.isProposalExecuted([
        originDomainID,
        expectedDepositNonce
      ])
    );

    // check that tokens are transferred to recipient address
    const recipientBalance = await ERC20MintableInstance.read.balanceOf([
      recipient.account!.address
    ]);
    assert.strictEqual(recipientBalance, depositAmount);
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
        originDomainID,
        resourceID,
        depositData,
        feeData
      ],
        {
          account: depositor.account,
        }
      )
    ).not.to.be.reverted;

    await expect(
      BridgeInstance.write.executeProposal([
        proposal,
        proposalSignedData
      ],
        {
          account: relayer1.account,
        }
      )
    ).to.be.revertedWithCustomError(BridgeInstance, "InvalidProposalSigner()");
  });
});
