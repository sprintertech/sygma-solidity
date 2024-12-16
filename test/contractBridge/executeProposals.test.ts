import hre from 'hardhat';
// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import {concat, encodeAbiParameters, Hex, keccak256, parseAbiParameters, WalletClient} from "viem";
import {deploySourceChainContracts, mpcAddress, trimPrefix, createResourceID, createERCDepositData, createERC721DepositProposalData, createERC1155DepositData, createERC1155DepositProposalData} from "../helpers";
import {ContractTypesMap} from "hardhat/types";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {assert, expect} from 'chai';
import {Proposal} from '../../types';


describe("Bridge - [execute proposals]", () => {
  const destinationDomainID = 1;
  const originDomainID = 2;


  const tokenID = BigInt(1);
  const erc721DepositMetadata = "0xf00d";
  const initialTokenAmount = BigInt(100);
  const depositAmount = BigInt(10);
  const expectedDepositNonces = [1, 2, 3];
  const feeData = "0x";
  const emptySetResourceData = "0x";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];
  let ERC20HandlerInstance: ContractTypesMap["ERC20Handler"];
  let ERC721MintableInstance: ContractTypesMap["ERC721MinterBurnerPauser"];
  let ERC721HandlerInstance: ContractTypesMap["ERC721Handler"];
  let ERC1155MintableInstance: ContractTypesMap["ERC1155PresetMinterPauser"];
  let ERC1155HandlerInstance: ContractTypesMap["ERC1155Handler"];

  let depositor: WalletClient;
  let recipient: WalletClient;
  let relayer1: WalletClient;

  let erc20ResourceID: Hex;
  let erc721ResourceID: Hex;
  let erc1155ResourceID: Hex;
  let erc20DepositData: Hex;
  let erc20DepositProposalData: Hex;
  let erc20DataHash: Hex;
  let erc721DepositData: Hex;
  let erc721DepositProposalData: Hex;
  let erc721DataHash: Hex;
  let erc1155DepositData: Hex;
  let erc1155DepositProposalData: Hex;
  let erc1155DataHash: Hex;

  let proposalsForExecution: Array<Proposal>;

  before(async () => {
    ({
      BridgeInstance,
      ERC20MintableInstance,
      ERC20HandlerInstance,
      ERC721MintableInstance,
      ERC721HandlerInstance,
      ERC1155MintableInstance,
      ERC1155HandlerInstance
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      depositor,
      recipient,
      relayer1
    ] = await hre.viem.getWalletClients();

    erc20ResourceID = createResourceID(
      ERC20MintableInstance.address,
      destinationDomainID
    );
    erc721ResourceID = createResourceID(
      ERC721MintableInstance.address,
      destinationDomainID
    );
    erc1155ResourceID = createResourceID(
      ERC1155MintableInstance.address,
      destinationDomainID
    );

    await ERC20MintableInstance.write.mint([depositor.account!.address, initialTokenAmount]),
    await BridgeInstance.write.adminSetResource([
      ERC20HandlerInstance.address,
      erc20ResourceID,
      ERC20MintableInstance.address,
      emptySetResourceData
    ]);
    await ERC721MintableInstance.write.grantRole([
      await ERC721MintableInstance.read.MINTER_ROLE(),
      ERC721HandlerInstance.address
    ]);
    await ERC721MintableInstance.write.mint([depositor.account!.address, tokenID, ""]);
    await BridgeInstance.write.adminSetResource([
      ERC721HandlerInstance.address,
      erc721ResourceID,
      ERC721MintableInstance.address,
      emptySetResourceData
    ]);
    await BridgeInstance.write.adminSetResource([
      ERC1155HandlerInstance.address,
      erc1155ResourceID,
      ERC1155MintableInstance.address,
      emptySetResourceData
    ]),
    await ERC1155MintableInstance.write.mintBatch([
      depositor.account!.address,
      [tokenID],
      [initialTokenAmount],
      "0x0"
    ]);

    await ERC20MintableInstance.write.approve([
      ERC20HandlerInstance.address,
      depositAmount
    ],
      {
        account: depositor.account
      }
    );
    await ERC721MintableInstance.write.approve([
      ERC721HandlerInstance.address,
      tokenID
    ],
      {
        account: depositor.account,
    });
    await ERC1155MintableInstance.write.setApprovalForAll([
      ERC1155HandlerInstance.address,
      true
    ],
      {
        account: depositor.account
      }
    );

    erc20DepositData = createERCDepositData(
      depositAmount,
      20,
      recipient.account!.address
    );
    erc20DepositProposalData = createERCDepositData(
      depositAmount,
      20,
      recipient.account!.address
    );
    erc20DataHash = keccak256(
      concat([
        ERC20HandlerInstance.address,
        trimPrefix(erc20DepositProposalData)
      ])
    );

    erc721DepositData = createERCDepositData(
      tokenID,
      20,
      recipient.account!.address
    );
    erc721DepositProposalData = createERC721DepositProposalData(
      tokenID,
      20,
      recipient.account!.address,
      erc721DepositMetadata.length,
      erc721DepositMetadata
    );
    erc721DataHash = keccak256(
      concat([
        ERC721HandlerInstance.address,
        trimPrefix(erc721DepositProposalData)
      ])
    );

    erc1155DepositData = createERC1155DepositData(
      [tokenID],
      [depositAmount]
    );
    erc1155DepositProposalData = createERC1155DepositProposalData(
      [tokenID],
      [depositAmount],
      recipient.account!.address,
      "0x"
    );
    erc1155DataHash = keccak256(
      concat([
        ERC1155HandlerInstance.address,
        trimPrefix(erc1155DepositProposalData)
      ])
    );

    proposalsForExecution = [
      {
        originDomainID: originDomainID,
        depositNonce: BigInt(expectedDepositNonces[0]),
        resourceID: erc20ResourceID,
        data: erc20DepositProposalData,
      },
      {
        originDomainID: originDomainID,
        depositNonce: BigInt(expectedDepositNonces[1]),
        resourceID: erc721ResourceID,
        data: erc721DepositProposalData,
      },
      {
        originDomainID: originDomainID,
        depositNonce: BigInt(expectedDepositNonces[2]),
        resourceID: erc1155ResourceID,
        data: erc1155DepositProposalData,
      },
    ];

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("should create and execute executeProposal successfully", async () => {
    const proposalSignedData = await signTypedProposal(
      BridgeInstance.address,
      proposalsForExecution
    );

    // depositor makes initial deposit of depositAmount
    assert.isFalse(await BridgeInstance.read.paused());
    await expect(
      BridgeInstance.write.deposit([
        originDomainID,
        erc20ResourceID,
        erc20DepositData,
        feeData
      ],
        {
          account: depositor.account
        }
      )
    ).not.to.be.reverted;

    await expect(
      BridgeInstance.write.deposit([
        originDomainID,
        erc721ResourceID,
        erc721DepositData,
        feeData
      ],
        {
          account: depositor.account
        }
      )
    ).not.to.be.reverted;

    await expect(
      BridgeInstance.write.deposit([
        originDomainID,
        erc1155ResourceID,
        erc1155DepositData,
        feeData
      ],
        {
          account: depositor.account
        }
      )
    ).not.to.be.reverted;

    const executeTx = await BridgeInstance.write.executeProposals([
      proposalsForExecution,
      proposalSignedData
    ],
      {
        account: relayer1.account!.address
      }
    );

    await expect(executeTx).not.to.be.reverted;

    // check that deposit nonces had been marked as used in bitmap
    expectedDepositNonces.forEach(async (_, index) => {
      assert.isTrue(
        await BridgeInstance.read.isProposalExecuted([
          originDomainID,
          BigInt(expectedDepositNonces[index])
        ])
      );
    });

    // check that tokens are transferred to recipient address
    const recipientERC20Balance = await ERC20MintableInstance.read.balanceOf([
      recipient.account!.address
    ]);
    assert.strictEqual(recipientERC20Balance, depositAmount);

    const recipientERC721Balance = await ERC721MintableInstance.read.balanceOf([
      recipient.account!.address
    ]);
    assert.strictEqual(recipientERC721Balance, BigInt(1));

    const recipientERC1155Balance = await ERC1155MintableInstance.read.balanceOf([
      recipient.account!.address,
      BigInt(destinationDomainID)
    ]);
    assert.strictEqual(recipientERC1155Balance, depositAmount);
  });

  it("should skip executing proposal if deposit nonce is already used", async () => {
    const proposalSignedData = await signTypedProposal(
      BridgeInstance.address,
      proposalsForExecution
    );

    // depositor makes initial deposit of depositAmount
    assert.isFalse(await BridgeInstance.read.paused());
    await expect(
      BridgeInstance.write.deposit([
        originDomainID,
        erc20ResourceID,
        erc20DepositData,
        feeData
      ],
        {
          account: depositor.account
        }
      )
    ).not.to.be.reverted;

    await expect(
      BridgeInstance.write.deposit([
        originDomainID,
        erc721ResourceID,
        erc721DepositData,
        feeData
      ],
        {
          account: depositor.account
        }
      )
    ).not.to.be.reverted;

    await expect(
      BridgeInstance.write.deposit([
        originDomainID,
        erc1155ResourceID,
        erc1155DepositData,
        feeData
      ],
        {
          account: depositor.account
        }
      )
    ).not.to.be.reverted;

    const executeTx = await BridgeInstance.write.executeProposals([
      proposalsForExecution,
      proposalSignedData
    ],
      {
        account: relayer1.account
      }
    );

    await expect(executeTx).not.to.be.reverted;

    // check that deposit nonces had been marked as used in bitmap
    expectedDepositNonces.forEach(async (_, index) => {
      assert.isTrue(
        await BridgeInstance.read.isProposalExecuted([
          originDomainID,
          BigInt(expectedDepositNonces[index])
        ])
      );
    });

    // check that tokens are transferred to recipient address
    const recipientERC20Balance = await ERC20MintableInstance.read.balanceOf([
      recipient.account!.address
    ]);
    assert.strictEqual(recipientERC20Balance, depositAmount);

    const recipientERC721Balance = await ERC721MintableInstance.read.balanceOf([
      recipient.account!.address
    ]);
    assert.strictEqual(recipientERC721Balance, BigInt(1));

    const recipientERC1155Balance = await ERC1155MintableInstance.read.balanceOf([
      recipient.account!.address,
      BigInt(destinationDomainID)
    ]);
    assert.strictEqual(recipientERC1155Balance, depositAmount);

    const skipExecuteTx = await BridgeInstance.write.executeProposals([
      proposalsForExecution,
      proposalSignedData
    ],
      {
        account: relayer1.account
      }
    );

    // check that no ProposalExecution events are emitted
    await expect(skipExecuteTx).not.to.emit(BridgeInstance, "ProposalExecution");
  });

  it("should fail executing proposals if empty array is passed for execution", async () => {
    const proposalSignedData = await signTypedProposal(
      BridgeInstance.address,
      proposalsForExecution
    );

    await expect(
      BridgeInstance.write.executeProposals([[], proposalSignedData
      ],
        {
          account: relayer1.account
        }
      )
    ).to.be.revertedWithCustomError(BridgeInstance, "EmptyProposalsArray()");
  });

  it("executeProposal event should be emitted with expected values", async () => {
    const proposalSignedData = await signTypedProposal(
      BridgeInstance.address,
      proposalsForExecution
    );

    // depositor makes initial deposit of depositAmount
    assert.isFalse(await BridgeInstance.read.paused());
    await expect(
      BridgeInstance.write.deposit([
        originDomainID,
        erc20ResourceID,
        erc20DepositData,
        feeData
      ],
        {
          account: depositor.account
        }
      )
    ).not.to.be.reverted;

    await expect(
      BridgeInstance.write.deposit([
        originDomainID,
        erc721ResourceID,
        erc721DepositData,
        feeData
      ],
        {
          account: depositor.account
        }
      )
    ).not.to.be.reverted;

    await expect(
      BridgeInstance.write.deposit([
        originDomainID,
        erc1155ResourceID,
        erc1155DepositData,
        feeData
      ],
        {
          account: depositor.account
        }
      )
    ).not.to.be.reverted;

    const executeTx = await BridgeInstance.write.executeProposals([
      proposalsForExecution,
      proposalSignedData
    ],
      {
        account: relayer1.account!.address
      }
    );

    // check that ProposalExecution has been emitted with expected values for ERC20
    await expect(executeTx).to.emit(BridgeInstance, "ProposalExecution").withArgs(
      originDomainID,
      expectedDepositNonces[0],
      erc20DataHash,
      encodeAbiParameters(
        parseAbiParameters(["address", "address", "uint256"]),
        [ERC20MintableInstance.address, recipient.account!.address, depositAmount]
      )
    );
    // check that ProposalExecution has been emitted with expected values for ERC721
    await expect(executeTx).to.emit(BridgeInstance, "ProposalExecution").withArgs(
      originDomainID,
      expectedDepositNonces[1],
      erc721DataHash,
      encodeAbiParameters(
        parseAbiParameters(["address", "address", "uint256"]),
        [ERC721MintableInstance.address, recipient.account!.address, tokenID]
      )
    );

    // check that ProposalExecution has been emitted with expected values for ERC1155
    await expect(executeTx).to.emit(BridgeInstance, "ProposalExecution").withArgs(
      originDomainID,
      expectedDepositNonces[2],
      erc1155DataHash,
      encodeAbiParameters(
        parseAbiParameters(["address", "address", "uint256"]),
        [ERC1155MintableInstance.address, recipient.account!.address, tokenID]
      )
    );

    // check that deposit nonces had been marked as used in bitmap
    expectedDepositNonces.forEach(async (_, index) => {
      assert.isTrue(
        await BridgeInstance.read.isProposalExecuted([
          originDomainID,
          BigInt(expectedDepositNonces[index])
        ])
      );
    });

    // check that tokens are transferred to recipient address
    const recipientERC20Balance = await ERC20MintableInstance.read.balanceOf([
      recipient.account!.address
    ]);
    assert.strictEqual(recipientERC20Balance, depositAmount);

    const recipientERC721Balance = await ERC721MintableInstance.read.balanceOf([
      recipient.account!.address
    ]);
    assert.strictEqual(recipientERC721Balance, BigInt(1));

    const recipientERC1155Balance = await ERC1155MintableInstance.read.balanceOf([
      recipient.account!.address,
      BigInt(destinationDomainID)
    ]);
    assert.strictEqual(recipientERC1155Balance, depositAmount);
  });

  it(`should fail to executeProposals if signed Proposal has
      different chainID than the one on which it should be executed`, async () => {
    const proposalSignedData =
      await mockSignTypedProposalWithInvalidChainID(
        BridgeInstance.address,
        proposalsForExecution
      );

    // depositor makes initial deposit of depositAmount
    assert.isFalse(await BridgeInstance.read.paused());
    await expect(
      BridgeInstance.write.deposit([
        originDomainID,
        erc20ResourceID,
        erc20DepositData,
        feeData
      ],
        {
          account: depositor.account
        }
      )
    ).not.to.be.reverted;

    await expect(
      BridgeInstance.write.deposit([
        originDomainID,
        erc721ResourceID,
        erc721DepositData,
        feeData
      ],
        {
          account: depositor.account
        }
      )
    ).not.to.be.reverted;

    await expect(
      BridgeInstance.write.deposit([
        originDomainID,
        erc1155ResourceID,
        erc1155DepositData,
        feeData
      ],
        {
          account: depositor.account
        }
      )
    ).not.to.be.reverted;

    await expect(
      BridgeInstance.write.executeProposals([
        proposalsForExecution,
        proposalSignedData
      ],
        {
          account: relayer1.account
        }
      )
    ).to.be.revertedWithCustomError(BridgeInstance, "InvalidProposalSigner()");
  });
});
