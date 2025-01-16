// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from "hardhat";
import {assert, expect} from "chai";
import {encodeAbiParameters, Hex, keccak256, parseAbiParameters, parseEther, parseUnits, WalletClient,  concat, toHex} from "viem";
import {createERC721DepositProposalData, createResourceID, createERCDepositData, deploySourceChainContracts, deployDestinationChainContracts, getBalance, mpcAddress, signTypedProposal, trimPrefix, createDepositProposalDataFromHandlerResponse} from "../../helpers";
import {ContractTypesMap} from "hardhat/types";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {Proposal} from "../../../types";


describe("E2E ERC721 - Same Chain", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;
  const tokenID = BigInt(1);
  const depositMetadata = "0xc0ff33" as unknown as Hex;
  const expectedDepositNonce = BigInt(1);
  const feeData = "0x";
  const emptySetResourceData = "0x";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC721MintableInstance: ContractTypesMap["ERC721MinterBurnerPauser"];
  let ERC721HandlerInstance: ContractTypesMap["ERC721Handler"];
  let DefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];

  let admin: WalletClient;
  let depositor: WalletClient;
  let recipient: WalletClient;
  let relayer1: WalletClient;

  let resourceID: Hex;
  let depositData: Hex;
  let depositProposalData: Hex;
  let proposalData: Hex;
  let proposal: Proposal;
  let depositProposalDataHash: Hex;

  beforeEach(async () => {
    ({
      DefaultMessageReceiverInstance,
      BridgeInstance,
      ERC721MintableInstance,
      ERC721HandlerInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      admin,
      depositor,
      recipient,
      relayer1,
    ] = await hre.viem.getWalletClients();

    resourceID = createResourceID(
      ERC721MintableInstance.address,
      originDomainID
    );

    await ERC721MintableInstance.write.mint([depositor.account!.address, tokenID, depositMetadata]);
    await BridgeInstance.write.adminSetResource([
      ERC721HandlerInstance.address,
      resourceID,
      ERC721MintableInstance.address,
      emptySetResourceData
    ]);

    await ERC721MintableInstance.write.approve([
      ERC721HandlerInstance.address,
      tokenID],
      {account: depositor.account}
    );

    depositData = createERCDepositData(tokenID, 20, recipient);
    proposalData = createERC721DepositProposalData(
      tokenID,
      20,
      recipient.account!.address,
      depositMetadata.length,
      depositMetadata
    );
    depositProposalDataHash = keccak256(
      concat([
        ERC721HandlerInstance.address,
        trimPrefix(proposalData)
      ])
    );

    proposal = {
      originDomainID: originDomainID,
      depositNonce: expectedDepositNonce,
      data: proposalData,
      resourceID: resourceID,
    };

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("[sanity] depositor' should own tokenID", async () => {
    const tokenOwner = await ERC721MintableInstance.read.ownerOf([tokenID]);
    assert.strictEqual(depositor.account!.address, tokenOwner);
  });

  it("[sanity] ERC721HandlerInstance.address should have an allowance for tokenID from depositor", async () => {
    const allowedAddress = await ERC721MintableInstance.read.getApproved([tokenID]);
    assert.strictEqual(ERC721HandlerInstance.address, allowedAddress);
  });

  it("depositAmount of Destination ERC721 should be transferred to recipient", async () => {
    // depositor makes initial deposit of depositAmount
    await expect(
      BridgeInstance.write.deposit([originDomainID, resourceID, depositData, feeData], {
        account: depositor.account,
      })
    ).not.to.be.reverted;

    // Handler should have a balance of depositAmount
    const tokenOwner = await ERC721MintableInstance.read.ownerOf([tokenID]);
    assert.strictEqual(ERC721HandlerInstance.address, tokenOwner);

    const proposalSignedData = signTypedProposal(
      BridgeInstance.address,
      [proposal]
    );

    // relayer1 creates the deposit proposal
    await expect(
      BridgeInstance.write.executeProposal([proposal, proposalSignedData], {
        account: relayer1.account,
      })
    ).not.to.be.reverted;

    // Assert ERC721 balance was transferred from depositor
    const tokenOwnerAfterTransfer = await ERC721MintableInstance.read.ownerOf([
      tokenID
    ]);
    assert.strictEqual(recipient.account!.address, tokenOwnerAfterTransfer);
  });
});
