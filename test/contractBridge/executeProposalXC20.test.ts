// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {concat, encodeAbiParameters, Hex, keccak256, parseAbiParameters, WalletClient, zeroAddress} from "viem";
import {createERCDepositData, createResourceID, deploySourceChainContracts, mockSignTypedProposalWithInvalidChainID, mpcAddress, signTypedProposal, trimPrefix} from "../helpers";
import {ContractTypesMap} from "hardhat/types";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {assert, expect} from "chai";
import {Proposal} from '../../types';

const Helpers = require("../helpers");

describe("Bridge - [execute proposal - XC20]", async () => {
  const originDomainID = 1;
  const destinationDomainID = 2;
  const initialTokenAmount = BigInt(100);
  const depositAmount = BigInt(10);
  const expectedDepositNonce = BigInt(1);
  const feeData = "0x";
  const emptySetResourceData = "0x";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let XC20TestInstance: ContractTypesMap["XC20Test"];
  let XC20HandlerInstance: ContractTypesMap["XC20Handler"];

  let depositor: WalletClient;
  let recipient: WalletClient;
  let relayer1: WalletClient;

  let resourceID: Hex;
  let depositData: Hex;
  let depositProposalData;

  let dataHash: Hex;
  let proposal: Proposal;

  before(async () => {
    ({
      XC20TestInstance,
      BridgeInstance,
      XC20HandlerInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      depositor,
      recipient,
      relayer1,
    ] = await hre.viem.getWalletClients();

    resourceID = createResourceID(
      XC20TestInstance.address,
      destinationDomainID
    );

    await BridgeInstance.write.adminSetResource([
      XC20HandlerInstance.address,
      resourceID,
      XC20TestInstance.address,
      emptySetResourceData
    ]);
    await XC20TestInstance.write.mint([
      depositor.account!.address,
      initialTokenAmount
    ]);

    await BridgeInstance.write.adminSetBurnable([
      XC20HandlerInstance.address,
      XC20TestInstance.address
    ]);

    depositData = createERCDepositData(depositAmount, 20, recipient.account!.address);
    dataHash = keccak256(
      concat([
        XC20HandlerInstance.address,
        trimPrefix(depositData)
      ])
    );

    await XC20TestInstance.write.approve([
      XC20HandlerInstance.address,
      depositAmount
    ],
      {
        account: depositor.account,
      }
    );

    depositData = createERCDepositData(
      depositAmount,
      20,
      recipient.account!.address
    );
    depositProposalData = createERCDepositData(
      depositAmount,
      20,
      recipient.account!.address
    );

    proposal = {
      originDomainID: originDomainID,
      depositNonce: expectedDepositNonce,
      resourceID: resourceID,
      data: depositProposalData,
    };

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);

  });

  describe("lock/release strategy", async () => {
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
        ],
          {
            account: depositor.account
          }
        )
      ).not.to.be.reverted;

      await expect(
        BridgeInstance.write.executeProposal([
          proposal,
          proposalSignedData
        ],
          {
            account: relayer1.account
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
      const recipientBalance = await XC20TestInstance.read.balanceOf([
        recipient
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
            account: depositor.account
          }
        )
      ).not.to.be.reverted;

      await expect(
        BridgeInstance.write.executeProposal([
          proposal, proposalSignedData
        ],
          {
            account: relayer1.account
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
            account: depositor.account
          }
        )
      ).not.to.be.reverted;

      const proposalTx = await BridgeInstance.write.executeProposal([
        proposal,
        proposalSignedData],
        {account: relayer1}
      );

      await expect(proposalTx).to.emit(BridgeInstance, "ProposalExecution").withArgs(
        originDomainID,
        expectedDepositNonce,
        dataHash
      );

      // check that deposit nonce has been marked as used in bitmap
      assert.isTrue(
        await BridgeInstance.read.isProposalExecuted([
          originDomainID,
          expectedDepositNonce
        ])
      );

      // check that tokens are transferred to recipient address
      const recipientBalance = await XC20TestInstance.read.balanceOf([
        recipient.account!.address
      ]);
      assert.strictEqual(recipientBalance, depositAmount);
    });

    it(`should fail to executeProposal if signed Proposal has
        different chainID than the one on which it should be executed`, async () => {
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
            account: depositor.account
          }
        )
      ).not.to.be.reverted;

      await expect(
        BridgeInstance.write.executeProposal([
          proposal,
          proposalSignedData
        ],
          {
            account: relayer1.account
          }
        )
      ).to.be.revertedWithCustomError(BridgeInstance, "InvalidProposalSigner()");
    });
  });

  describe("mint/burn strategy", async () => {
    before(async () => {
      await BridgeInstance.write.adminSetBurnable([
        XC20HandlerInstance.address,
        XC20TestInstance.address
      ]);
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
        ],
          {
            account: depositor.account
          }
        )
      ).not.to.be.reverted;

      await expect(
        BridgeInstance.write.executeProposal([
          proposal,
          proposalSignedData
        ],
          {
            account: relayer1.account
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
      const recipientBalance = await XC20TestInstance.read.balanceOf(
        recipient.account!.address
      );
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
            account: depositor.account
          }
        )
      ).not.to.be.reverted;

      await expect(
        BridgeInstance.write.executeProposal([
          proposal, proposalSignedData
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
            account: depositor.account
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
        dataHash
      );

      // check that deposit nonce has been marked as used in bitmap
      assert.isTrue(
        await BridgeInstance.read.isProposalExecuted([
          originDomainID,
          expectedDepositNonce
        ])
      );

      // check that tokens are transferred to recipient address
      const recipientBalance = await XC20TestInstance.read.balanceOf([
        recipient.account!.address
      ]);
      assert.strictEqual(recipientBalance, depositAmount);
    });

    it(`should fail to executeProposal if signed Proposal
        has different chainID than the one on which it should be executed`, async () => {
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
            account: depositor.account
          }
        )
      ).not.to.be.reverted;

      await expect(
        BridgeInstance.write.executeProposal([
          proposal,
          proposalSignedData
        ],
          {
            account: relayer1.account
         }
        )
      ).revertedWithCustomError(BridgeInstance, "InvalidProposalSigner()");
    });
  });

  it(`transfer event should be emitted with expected values when executing proposal -
      mint to handler and then transfer to recipient`, async () => {
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
          account: depositor.account
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
        [XC20TestInstance.address, recipient.account!.address, depositAmount]
      )
    );

    // check that tokens are minted to handler
    await expect(proposalTx).to.emit(XC20TestInstance, "Transfer").withArgs(
      zeroAddress,
      XC20HandlerInstance.address,
      depositAmount
    )

    // check that deposit nonce has been marked as used in bitmap
    assert.isTrue(
      await BridgeInstance.read.isProposalExecuted([
        originDomainID,
        expectedDepositNonce
      ])
    );

    // check that tokens are transferred to recipient address
    const recipientBalance = await XC20TestInstance.read.balanceOf([recipient.account!.address]);
    assert.strictEqual(recipientBalance, depositAmount);
  });
});
