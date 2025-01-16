// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from "hardhat";
import {assert, expect} from "chai";
import {encodeAbiParameters, Hex, keccak256, parseAbiParameters, parseEther, parseUnits, WalletClient,  concat, toHex} from "viem";
import {createBtcDepositData, createERC721DepositProposalData, createERCDepositData, deploySourceChainContracts, deployDestinationChainContracts, getBalance, mpcAddress, signTypedProposal, trimPrefix, createDepositProposalDataFromHandlerResponse} from "../../helpers";
import {ContractTypesMap} from "hardhat/types";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {Proposal} from "../../../types";
import {createResourceID} from "../../helpers";

describe("E2E ERC721 - Two EVM Chains", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;
  const tokenID = BigInt(1);
  const expectedDepositNonce = BigInt(1);
  const feeData = "0x";
  const emptySetResourceData = "0x";

  let OriginBridgeInstance: ContractTypesMap["Bridge"];
  let OriginDefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];
  let OriginERC721MintableInstance: ContractTypesMap["ERC721MinterBurnerPauser"];
  let OriginERC721HandlerInstance: ContractTypesMap["ERC721Handler"];

  let originDepositProposalData: Hex;
  let originDepositData: Hex;
  let originResourceID: Hex;;
  let originDomainProposal: Proposal;
  let originDepositProposalDataHash: Hex;

  let DestinationBridgeInstance: ContractTypesMap["Bridge"];;
  let DestinationDefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];
  let DestinationERC721MintableInstance: ContractTypesMap["ERC721MinterBurnerPauser"];
  let DestinationERC721HandlerInstance: ContractTypesMap["ERC721Handler"];

  let destinationDepositData: Hex;
  let destinationDepositProposalData: Hex;
  let destinationResourceID: Hex;
  let destinationDomainProposal: Proposal;
  let destinationDepositProposalDataHash: Hex;

  let admin: WalletClient;
  let depositor: WalletClient;
  let recipient: WalletClient;
  let originRelayer1: WalletClient;
  let destinationRelayer1: WalletClient;

  beforeEach(async () => {
    ({
      DefaultMessageReceiverInstance: OriginDefaultMessageReceiverInstance,
      BridgeInstance: OriginBridgeInstance,
      ERC721MintableInstance: OriginERC721MintableInstance,
      ERC721HandlerInstance: OriginERC721HandlerInstance,
    } = await loadFixture(deploySourceChainContracts));
    ({
      DefaultMessageReceiverInstance: DestinationDefaultMessageReceiverInstance,
      BridgeInstance: DestinationBridgeInstance,
      ERC721MintableInstance: DestinationERC721MintableInstance,
      ERC721HandlerInstance: DestinationERC721HandlerInstance,
    } = await loadFixture(deployDestinationChainContracts));
    [
      admin,
      depositor,
      recipient,
      originRelayer1,
      destinationRelayer1,
    ] = await hre.viem.getWalletClients();

    originResourceID = createResourceID(
      OriginERC721MintableInstance.address,
      originDomainID
    );

    destinationResourceID = createResourceID(
      DestinationERC721MintableInstance.address,
      originDomainID
    );

    await OriginERC721MintableInstance.write.mint([depositor.account!.address, tokenID, ""]);

    await OriginERC721MintableInstance.write.approve([
      OriginERC721HandlerInstance.address,
      tokenID],
      {account: depositor.account}
    );
    await DestinationERC721MintableInstance.write.grantRole([
      await DestinationERC721MintableInstance.read.MINTER_ROLE(),
      DestinationERC721HandlerInstance.address
    ]);
    await OriginBridgeInstance.write.adminSetResource([
      OriginERC721HandlerInstance.address,
      originResourceID,
      OriginERC721MintableInstance.address,
      emptySetResourceData
    ]);
    await DestinationBridgeInstance.write.adminSetResource([
      DestinationERC721HandlerInstance.address,
      destinationResourceID,
      DestinationERC721MintableInstance.address,
      emptySetResourceData
    ]);
    await DestinationBridgeInstance.write.adminSetBurnable([
      DestinationERC721HandlerInstance.address,
      DestinationERC721MintableInstance.address,
    ]),

    originDepositData = createERCDepositData(
      tokenID,
      20,
      recipient
    );
    originDepositProposalData = createERC721DepositProposalData(
      tokenID,
      20,
      recipient.account!.address,
      32,
      toHex(0)
    );

    destinationDepositData = createERCDepositData(
      tokenID,
      20,
      depositor
    );
    destinationDepositProposalData = createERC721DepositProposalData(
      tokenID,
      20,
      depositor.account!.address,
      32,
      toHex(0)
    );
    destinationDepositProposalDataHash = keccak256(
      concat([
        OriginERC721HandlerInstance.address,
        trimPrefix(destinationDepositProposalData)
      ])
    );

    originDomainProposal = {
      originDomainID: originDomainID,
      depositNonce: expectedDepositNonce,
      data: originDepositProposalData,
      resourceID: destinationResourceID,
    };

    destinationDomainProposal = {
      originDomainID: destinationDomainID,
      depositNonce: expectedDepositNonce,
      data: destinationDepositProposalData,
      resourceID: originResourceID,
    };

    // set MPC address to unpause the Bridge
    await OriginBridgeInstance.write.endKeygen([mpcAddress]);
    await DestinationBridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("[sanity] depositor' should own tokenID", async () => {
    const tokenOwner = await OriginERC721MintableInstance.read.ownerOf([tokenID]);
    assert.strictEqual(depositor.account!.address, tokenOwner);
  });

  it("[sanity] ERC721HandlerInstance.address should have an allowance for tokenID from depositor", async () => {
    const allowedAddress = await OriginERC721MintableInstance.read.getApproved([
      tokenID
    ]);
    assert.strictEqual(OriginERC721HandlerInstance.address, allowedAddress);
  });

  it(`[sanity] DestinationERC721HandlerInstance.address should have
      minterRole for DestinationERC721MintableInstance`, async () => {
    const isMinter = await DestinationERC721MintableInstance.read.hasRole([
      await DestinationERC721MintableInstance.read.MINTER_ROLE(),
      DestinationERC721HandlerInstance.address
    ]);
    assert.isTrue(isMinter);
  });

  it(`E2E: tokenID of Origin ERC721 owned by depositAddress to Destination ERC721
      owned by recipient and back again`, async () => {
    const originProposalSignedData = signTypedProposal(
      DestinationBridgeInstance.address,
      [originDomainProposal]
    );
    const destinationProposalSignedData = signTypedProposal(
      OriginBridgeInstance.address,
      [destinationDomainProposal]
    );

    let tokenOwner;

    // depositor makes initial deposit of tokenID
    await expect(
      OriginBridgeInstance.write.deposit([
        destinationDomainID,
        originResourceID,
        originDepositData,
        feeData],
        {account: depositor.account}
      )
    ).not.to.be.reverted;

    // Handler should own tokenID
    tokenOwner = await OriginERC721MintableInstance.read.ownerOf([tokenID]);
    assert.strictEqual(
      OriginERC721HandlerInstance.address,
      tokenOwner,
      "OriginERC721HandlerInstance.address does not own tokenID"
    );

    // destinationRelayer2 executes the proposal
    await expect(
      DestinationBridgeInstance.write.executeProposal([
        originDomainProposal,
        originProposalSignedData],
        {account: destinationRelayer1.account}
      )
    ).not.to.be.reverted;

    // Handler should still own tokenID of OriginERC721MintableInstance
    tokenOwner = await OriginERC721MintableInstance.read.ownerOf([tokenID]);
    assert.strictEqual(
      OriginERC721HandlerInstance.address,
      tokenOwner,
      "OriginERC721HandlerInstance.address does not own tokenID"
    );

    // Assert ERC721 balance was transferred from depositor
    tokenOwner = await DestinationERC721MintableInstance.read.ownerOf([tokenID]);
    assert.strictEqual(
      tokenOwner,
      recipient,
      "tokenID wasn't transferred from depositor to recipient"
    );

    // At this point a representation of OriginERC721Mintable has been transferred from
    // depositor to the recipient using Both Bridges and DestinationERC721Mintable.
    // Next we will transfer DestinationERC721Mintable back to the depositor

    await DestinationERC721MintableInstance.write.approve([
      DestinationERC721HandlerInstance.address,
      tokenID],
      {account: recipient.account}
    );

    // recipient makes a deposit of the received depositAmount
    await expect(
      DestinationBridgeInstance.write.deposit([
        originDomainID,
        destinationResourceID,
        destinationDepositData,
        feeData],
        {account: recipient.account}
      )
    ).not.to.be.reverted;

    // Token should no longer exist
    await expect(
      DestinationERC721MintableInstance.read.ownerOf([tokenID]),
      "ERC721: owner query for nonexistent token"
    ).to.be.reverted;

    // originRelayer executes the proposal
    await expect(
      OriginBridgeInstance.write.executeProposal([
        destinationDomainProposal,
        destinationProposalSignedData],
        {account: originRelayer1.account}
      )
    ).not.to.be.reverted;

    // Assert Destination tokenID no longer exists
    await expect(
      DestinationERC721MintableInstance.read.ownerOf([tokenID]),
      "ERC721: owner query for nonexistent token"
    ).to.be.reverted;

    // Assert DestinationERC721MintableInstance tokenID was transferred to recipient
    tokenOwner = await OriginERC721MintableInstance.read.ownerOf([tokenID]);
    assert.strictEqual(
      depositor.account!.address,
      tokenOwner,
      "OriginERC721MintableInstance tokenID was not transferred back to depositor"
    );
  });
});
