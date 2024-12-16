// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {concat, fromBytes, Hex, keccak256, toBytes, toFunctionSelector, toHex} from "viem";
import {deploySourceChainContracts, mpcAddress, trimPrefix, decimalToPaddedBinary} from "../helpers";
import {ContractTypesMap} from "hardhat/types";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {assert, expect} from 'chai';

const Helpers = require("../helpers");

describe("Bridge - [execute - FailedHandlerExecution]", async () => {
  const originDomainID = 1;
  const destinationDomainID = 2;
  const admin = accounts[0];
  const depositor = accounts[1];
  const recipient = accounts[2];
  const relayer1 = accounts[3];

  const tokenID = BigInt(1);
  const erc721DepositMetadata = "0xf00d";
  const initialTokenAmount = BigInt(100);
  const depositAmount = BigInt(10);
  const erc20Allowance = BigInt(5000);
  const expectedDepositNonces = [1, 2, 3, 4, 5, 6];
  const destinationMaxFee = 900000;
  const hashOfTestStore = keccak256("0xc0ffee");
  const feeData = "0x";
  const emptySetResourceData = "0x";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];
  let ERC20HandlerInstance: ContractTypesMap["ERC20Handler"];
  let ERC721MintableInstance: ContractTypesMap["ERC721MinterBurnerPauser"];
  let ERC721HandlerInstance: ContractTypesMap["ERC721Handler"];
  let ERC721RevertMintableInstance: ContractTypesMap["ERC721MinterBurnerPauser"];
  let ERC721RevertHandlerInstance: ContractTypesMap["HandlerRevert"];
  let ERC1155MintableInstance: ContractTypesMap["ERC1155PresetMinterPauser"];
  let ERC1155HandlerInstance: ContractTypesMap["ERC1155Handler"];
  let GmpHandlerInstance: ContractTypesMap["GmpHandler"];
  let XC20TestInstance: ContractTypesMap["XC20Test"];
  let XC20HandlerInstance: ContractTypesMap["XC20Handler"];;
  let TestStoreInstance: ContractTypesMap["TestStore"];

  let depositFunctionSignature: Hex;
  let GmpHandlerSetResourceData;
  let erc721DepositProposalDataHash: Hex;
  let erc721RevertDepositProposalDataHash: Hex;

  let erc20ResourceID: Hex;
  let erc721ResourceID: Hex;
  let erc721RevertResourceID: Hex;
  let erc1155ResourceID: Hex;
  let genericResourceID: Hex;
  let erc20DepositProposalData: Hex;
  let erc721DepositData: Hex;
  let erc721DepositProposalData: Hex;
  let erc721RevertDepositProposalData: Hex;
  let erc1155DepositProposalData: Hex;
  let xc20ResourceID: Hex;
  let xc20DepositProposalData: Hex;
  let genericProposalData: Hex;
  let genericDepositProposalDataHash: Hex;

  let proposalsForExecution: Array<Proposal>;

  before(async () => {
    ({
      BridgeInstance,
      ERC20MintableInstance,
      ERC20HandlerInstance,
      ERC721MintableInstance,
      ERC721HandlerInstance,
      ERC721MintableInstance: ERC721RevertMintableInstance,
      ERC1155MintableInstance,
      ERC1155HandlerInstance,
      XC20TestInstance,
      XC20HandlerInstance,
      TestStoreInstance,
      GmpHandlerInstance,
      HandlerRevert: ERC721RevertHandlerInstance
    } = await loadFixture(deploySourceChainContracts));
    [
      admin,
      depositor,
      evmRecipient,
      relayer1
    ] = await hre.viem.getWalletClients();

    erc20ResourceID = createResourceID(
      ERC20MintableInstance.address,
      originDomainID
    );
    erc721ResourceID = createResourceID(
      ERC721MintableInstance.address,
      originDomainID
    );
    erc721RevertResourceID = createResourceID(
      ERC721RevertMintableInstance.address,
      originDomainID
    );
    erc1155ResourceID = createResourceID(
      ERC1155MintableInstance.address,
      originDomainID
    );
    xc20ResourceID = createResourceID(
      XC20TestInstance.address,
      destinationDomainID
    );
    genericResourceID = createResourceID(
      GmpHandlerInstance.address,
      originDomainID
    );

    depositFunctionSignature = toFunctionSelector(
      TestStoreInstance.write.storeWithDepositor.toString()
    );

    GmpHandlerSetResourceData =
      constructGenericHandlerSetResourceData(
        depositFunctionSignature,
        blankFunctionDepositorOffset,
        blankFunctionSig
      );

    await ERC20MintableInstance.write.mint([depositor, initialTokenAmount]);
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
    await ERC721RevertMintableInstance.write.grantRole([
      await ERC721RevertMintableInstance.read.MINTER_ROLE(),
      ERC721RevertHandlerInstance.address
    ]);
    await ERC721MintableInstance.write.mint([
      depositor,
      tokenID,
      erc721DepositMetadata
    ]);
    await ERC721RevertMintableInstance.write.mint([
      depositor,
      tokenID,
      erc721DepositMetadata
    ]);
    await XC20TestInstance.write.mint([
      depositor,
      initialTokenAmount
    ]);
    await BridgeInstance.write.adminSetResource([
      ERC721HandlerInstance.address,
      erc721ResourceID,
      ERC721MintableInstance.address,
      emptySetResourceData
    ]);
    await BridgeInstance.write.adminSetResource([
      ERC721RevertHandlerInstance.address,
      erc721RevertResourceID,
      ERC721RevertMintableInstance.address,
      emptySetResourceData
    ]);
    await ERC1155MintableInstance.write.mintBatch([
      depositor,
      [tokenID],
      [initialTokenAmount],
      "0x0"
    ]);
    await BridgeInstance.write.adminSetResource([
      ERC1155HandlerInstance.address,
      erc1155ResourceID,
      ERC1155MintableInstance.address,
      emptySetResourceData
    ]);
    await BridgeInstance.write.adminSetResource([
      XC20HandlerInstance.address,
      xc20ResourceID,
      XC20TestInstance.address,
      emptySetResourceData
    ]);
    await BridgeInstance.write.adminSetResource([
      GmpHandlerInstance.address,
      genericResourceID,
      TestStoreInstance.address,
      GmpHandlerSetResourceData
    ]);

    await ERC20MintableInstance.write.approve([
      ERC20HandlerInstance.address,
      erc20Allowance
    ],
      {
        account: depositor.account,
      }
    );
    await ERC721MintableInstance.write.approve([
      ERC721HandlerInstance.address,
      tokenID
    ],
      {
        account: depositor.account,
      }
    );
    await ERC721RevertMintableInstance.write.approve([
      ERC721RevertHandlerInstance.address,
      tokenID
    ],
      {
        account: depositor.account
      }
    );
    await ERC1155MintableInstance.write.setApprovalForAll([
      ERC1155HandlerInstance.address,
      true
    ],
      {
        account: depositor.account
      }
    );
    await XC20TestInstance.write.approve([
      XC20HandlerInstance.address,
      depositAmount
    ],
      {
        account: depositor.account
      }
    );

    erc20DepositProposalData = createERCDepositData(
      depositAmount,
      20,
      recipient
    );

    erc721DepositData = createERCDepositData(
      tokenID,
      20,
      recipient
    );
    erc721DepositProposalData = createERC721DepositProposalData(
      tokenID,
      20,
      recipient,
      erc721DepositMetadata.length,
      erc721DepositMetadata
    );
    erc721DepositProposalDataHash = keccak256(
      concat([
        ERC721HandlerInstance.address,
        trimPrefix(erc721DepositProposalData)
      ])
    );
    xc20DepositProposalData = createERCDepositData(
      depositAmount * BigInt(5), // amount greater than allowance
      20,
      recipient
    );

    erc721RevertDepositProposalData = createERC721DepositProposalData(
      tokenID,
      20,
      recipient,
      erc721DepositMetadata.length,
      erc721DepositMetadata
    );
    erc721RevertDepositProposalDataHash = keccak256(
      concat([
        ERC721RevertHandlerInstance.address,
        trimPrefix(erc721RevertDepositProposalData)
      ])
    );


    erc1155DepositData = createERC1155DepositData(
      [tokenID],
      [depositAmount]
    );
    erc1155DepositProposalData = createERC1155DepositProposalData(
      [tokenID],
      [depositAmount],
      recipient,
      "0x"
    );

    genericProposalData = createGmpDepositData(
      depositFunctionSignature,
      TestStoreInstance.address,
      destinationMaxFee,
      depositor,
      hashOfTestStore
    );
    genericDepositProposalDataHash = keccak256(
      concat([
        GmpHandlerInstance.address,
        trimPrefix(genericProposalData)
      ])
    );

    proposalsForExecution = [
      {
        originDomainID: originDomainID,
        depositNonce: expectedDepositNonces[0],
        resourceID: erc20ResourceID,
        data: erc20DepositProposalData,
      },
      {
        originDomainID: originDomainID,
        depositNonce: expectedDepositNonces[1],
        resourceID: erc721ResourceID,
        data: erc721DepositProposalData,
      },
      {
        originDomainID: originDomainID,
        depositNonce: expectedDepositNonces[2],
        resourceID: erc721RevertResourceID,
        data: erc721RevertDepositProposalData,
      },
      {
        originDomainID: originDomainID,
        depositNonce: expectedDepositNonces[3],
        data: erc1155DepositProposalData,
        resourceID: erc1155ResourceID,
      },
      {
        originDomainID: originDomainID,
        depositNonce: expectedDepositNonces[4],
        resourceID: genericResourceID,
        data: genericProposalData,
      },
      {
        originDomainID: originDomainID,
        depositNonce: expectedDepositNonces[5],
        resourceID: xc20ResourceID,
        data: xc20DepositProposalData,
      },
    ];

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it(`[executeProposal - ERC20] - Should not revert if handler execution failed.
      FailedHandlerExecution event should be emitted`, async () => {
    const depositProposalBeforeFailedExecute =
      await BridgeInstance.read.isProposalExecuted([
        originDomainID,
        BigInt(expectedDepositNonces[0])
      ]);

    // depositNonce is not used
    assert.isFalse(depositProposalBeforeFailedExecute);

    const proposalSignedData = await signTypedProposal(
      BridgeInstance.address,
      [proposalsForExecution[0]]
    );

    const executeTx = await BridgeInstance.write.executeProposal([
      proposalsForExecution[0],
      proposalSignedData
    ],
      {
        account: relayer1
      }
    );

    await expect(executeTx).to.emit(BridgeInstance, "FailedHandlerExecution").withArgs(
      originDomainID,
      expectedDepositNonces[0],
      toHex(toBytes("Something bad happened"))
    )

    const depositProposalAfterFailedExecute =
      await BridgeInstance.read.isProposalExecuted([
        originDomainID,
        BigInt(expectedDepositNonces[0])
      ]);

    // depositNonce is not used
    assert.isFalse(depositProposalAfterFailedExecute);
  });

  it(`[executeProposal - ERC721] - Should not revert if handler execution failed.
      FailedHandlerExecution event should be emitted`, async () => {
    const depositProposalBeforeFailedExecute =
      await BridgeInstance.read.isProposalExecuted([
        originDomainID,
        BigInt(expectedDepositNonces[2])
      ]);

    // depositNonce is not used
    assert.isFalse(depositProposalBeforeFailedExecute);

    const proposalSignedData = await signTypedProposal(
      BridgeInstance.address,
      [proposalsForExecution[2]]
    );

    const executeTx = await BridgeInstance.write.executeProposal([
      proposalsForExecution[2],
      proposalSignedData
    ],
      {
        account: relayer1
      }
    );

    await expect(executeTx).to.emit(BridgeInstance, "FailedHandlerExecution").withArgs(
      originDomainID,
      expectedDepositNonces[0],
      toHex(toBytes("Something bad happened"))
    )

    const depositProposalAfterFailedExecute =
      await BridgeInstance.read.isProposalExecuted([
        originDomainID,
        BigInt(expectedDepositNonces[2])
      ]);

    // depositNonce is not used
    assert.isFalse(depositProposalAfterFailedExecute);
  });

  it(`[executeProposal - ERC1155] - Should not revert if handler execution failed.
      FailedHandlerExecution event should be emitted`, async () => {
    const depositProposalBeforeFailedExecute =
      await BridgeInstance.read.isProposalExecuted([
        originDomainID,
        BigInt(expectedDepositNonces[3])
      ]);

    // depositNonce is not used
    assert.isFalse(depositProposalBeforeFailedExecute);

    const proposalSignedData = await signTypedProposal(
      BridgeInstance.address,
      [proposalsForExecution[3]]
    );

    const executeTx = await BridgeInstance.write.executeProposal([
      proposalsForExecution[3],
      proposalSignedData
    ],
      {
        account: relayer1
      }
    );

    await expect(executeTx).to.emit(BridgeInstance, "FailedHandlerExecution").withArgs(
      originDomainID,
      expectedDepositNonces[0],
      toHex(toBytes("Something bad happened"))
    );

    const depositProposalAfterFailedExecute =
      await BridgeInstance.read.isProposalExecuted([
        originDomainID,
        BigInt(expectedDepositNonces[3])
      ]);

    // depositNonce is not used
    assert.isFalse(depositProposalAfterFailedExecute);
  });

  it(`[executeProposal - Generic] - Should not revert if handler execution failed.
      FailedHandlerExecution event should be emitted`, async () => {
    const depositProposalBeforeFailedExecute =
      await BridgeInstance.read.isProposalExecuted([
        originDomainID,
        BigInt(expectedDepositNonces[4])
      ]);

    // depositNonce is not used
    assert.isFalse(depositProposalBeforeFailedExecute);

    const proposalSignedData = await signTypedProposal(
      BridgeInstance.address,
      [proposalsForExecution[4]]
    );

    const executeTx = await BridgeInstance.write.executeProposal([
      proposalsForExecution[4],
      proposalSignedData
    ],
      {
        account: relayer1
      }
    );

    await expect(executeTx).to.emit(BridgeInstance, "ProposalExecution").withArgs(
      originDomainID,
      expectedDepositNonces[4],
      genericDepositProposalDataHash
    );

    const depositProposalAfterFailedExecute =
      await BridgeInstance.read.isProposalExecuted([
        originDomainID,
        BigInt(expectedDepositNonces[4])
      ]);

    // depositNonce is used
    assert.isTrue(depositProposalAfterFailedExecute);
  });

  it(`[executeProposal - XC20] - Should not revert if transferring tokens from XC20Safe to recipient failed.
      FailedHandlerExecution event should be emitted`, async () => {
    const depositProposalBeforeFailedExecute =
      await BridgeInstance.read.isProposalExecuted([
        originDomainID,
        BigInt(expectedDepositNonces[0])
      ]);

    // depositNonce is not used
    assert.isFalse(depositProposalBeforeFailedExecute);

    const proposalSignedData = await signTypedProposal(
      BridgeInstance.address,
      [proposalsForExecution[5]]
    );

    const executeTx = await BridgeInstance.write.executeProposal([
      proposalsForExecution[5],
      proposalSignedData
    ],
      {
        account: relayer1
      }
    );

    await expect(executeTx).to.emit(BridgeInstance, "FailedHandlerExecution").withArgs(
      originDomainID,
      expectedDepositNonces[0],
      toHex(toBytes("ERC20: call failed"))
    )

    const depositProposalAfterFailedExecute =
      await BridgeInstance.read.isProposalExecuted([
        originDomainID,
        BigInt(expectedDepositNonces[0])
      ]);

    // depositNonce is not used
    assert.isFalse(depositProposalAfterFailedExecute);
    });

  it(`[executeProposals] - Should not revert if handler execute is reverted and continue to process next execution.
      FailedHandlerExecution event should be emitted with expected values.`, async () => {
    const depositProposalBeforeFailedExecute =
      await BridgeInstance.read.isProposalExecuted([
        originDomainID,
        BigInt(expectedDepositNonces[0])
      ]);

    // depositNonce is not used
    assert.isFalse(depositProposalBeforeFailedExecute);

    const proposalSignedData = await signTypedProposal(
      BridgeInstance.address,
      proposalsForExecution
    );

    // depositor makes initial deposit of depositAmount
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

    // check that all nonces in nonce set are 0
    const noncesSetBeforeDeposit = await BridgeInstance.read.usedNonces([
      originDomainID,
      BigInt(0)
    ]);
    assert.equal(
      decimalToPaddedBinary(noncesSetBeforeDeposit),
      // nonces:                                          ...9876543210
      "0000000000000000000000000000000000000000000000000000000000000000"
    );

    const executeTx = await BridgeInstance.write.executeProposals([
      proposalsForExecution,
      proposalSignedData
    ],
      {
        account: relayer1.account
      }
    );

    await expect(executeTx).to.emit(BridgeInstance, "FailedHandlerExecution").withArgs(
      originDomainID,
      expectedDepositNonces[0],
      toHex(toBytes("Something bad happened"))
    );

    const erc20depositProposalAfterFailedExecute =
      await BridgeInstance.read.isProposalExecuted([
        originDomainID,
        BigInt(expectedDepositNonces[0])
      ]);
    // depositNonce for failed ERC20 deposit is unset
    assert.isFalse(erc20depositProposalAfterFailedExecute);

    const erc721depositProposal = await BridgeInstance.read.isProposalExecuted([
      originDomainID,
      BigInt(expectedDepositNonces[1])
    ]);
    // depositNonce for ERC721 deposit is used
    assert.isTrue(erc721depositProposal);

    const genericDepositProposal = await BridgeInstance.read.isProposalExecuted([
      originDomainID,
      BigInt(expectedDepositNonces[4])
    ]);
    // depositNonce for generic deposit is used
    assert.isTrue(genericDepositProposal);

    // recipient ERC20 token balances hasn't changed
    const recipientERC20Balance = await ERC20MintableInstance.read.balanceOf([
      recipient
    ]);
    assert.strictEqual(recipientERC20Balance, BigInt(0));

    // recipient ERC721 token balance has changed to 1 token
    const recipientERC721Balance = await ERC721MintableInstance.read.balanceOf([
      recipient
    ]);
    assert.strictEqual(recipientERC721Balance, BigInt(1));

    // check that other nonces in nonce set are not affected after failed deposit
    const noncesSetAfterDeposit = await BridgeInstance.read.usedNonces([
      originDomainID,
      BigInt(0)
    ]);
    assert.equal(
      decimalToPaddedBinary(noncesSetAfterDeposit),
      // nonces:                                          ...9876543210
      "0000000000000000000000000000000000000000000000000000000000100100"
    );

    // check that 'ProposalExecution' event has been emitted with proper values for ERC721Revert deposit
    await expect(executeTx).to.emit(BridgeInstance, "ProposalExecution").withArgs(
      originDomainID,
      expectedDepositNonces[1],
      erc721DepositProposalDataHash
    );

    // check that 'ProposalExecution' event has been emitted with proper values for generic deposit
    await expect(executeTx).to.emit(BridgeInstance, "ProposalExecution").withArgs(
      originDomainID,
      expectedDepositNonces[4],
      genericDepositProposalDataHash
    );
  });
});
