// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from "hardhat";
import {assert, expect} from "chai";
import {encodeAbiParameters, Hex, keccak256, parseAbiParameters, parseEther, parseUnits, WalletClient,  concat, toHex} from "viem";
import {ContractTypesMap} from "hardhat/types";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {Proposal} from "../../../types";
import { deploySourceChainContracts, deployDestinationChainContracts, mpcAddress, signTypedProposal, createERC1155DepositData, createERC1155DepositProposalData, createResourceID} from "../../helpers";

describe("E2E ERC1155 - Two EVM Chains", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;
  const tokenID = BigInt(1);
  const initialTokenAmount = BigInt(100);
  const depositAmount = BigInt(10);
  const expectedDepositNonce = 1;
  const feeData = "0x";
  const emptySetResourceData = "0x";

  let OriginBridgeInstance: ContractTypesMap["Bridge"];
  let OriginDefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];
  let OriginERC1155MintableInstance: ContractTypesMap["ERC1155PresetMinterPauser"];
  let OriginERC1155HandlerInstance: ContractTypesMap["ERC1155Handler"];

  let originDepositProposalData: Hex;
  let originDepositData: Hex;
  let originResourceID: Hex;;
  let originDomainProposal: Proposal;
  let originDepositProposalDataHash: Hex;

  let DestinationBridgeInstance: ContractTypesMap["Bridge"];;
  let DestinationDefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];
  let DestinationERC1155MintableInstance: ContractTypesMap["ERC1155PresetMinterPauser"];
  let DestinationERC1155HandlerInstance: ContractTypesMap["ERC1155Handler"];

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
      ERC1155MintableInstance: OriginERC1155MintableInstance,
      ERC1155HandlerInstance: OriginERC1155HandlerInstance,
    } = await loadFixture(deploySourceChainContracts));
    ({
      DefaultMessageReceiverInstance: DestinationDefaultMessageReceiverInstance,
      BridgeInstance: DestinationBridgeInstance,
      ERC1155MintableInstance: DestinationERC1155MintableInstance,
      ERC1155HandlerInstance: DestinationERC1155HandlerInstance,
    } = await loadFixture(deployDestinationChainContracts));
    [
      admin,
      depositor,
      recipient,
      originRelayer1,

      destinationRelayer1,
    ] = await hre.viem.getWalletClients();


    originResourceID = createResourceID(
      OriginERC1155MintableInstance.address,
      originDomainID
    );

    destinationResourceID = createResourceID(
      DestinationERC1155MintableInstance.address,
      originDomainID
    );

    await OriginERC1155MintableInstance.write.mintBatch([
      depositor.account!.address,
      [tokenID],
      [initialTokenAmount],
      "0x0"
    ]);

    await OriginERC1155MintableInstance.write.setApprovalForAll([
      OriginERC1155HandlerInstance.address,
      true],
      {account: depositor.account}
    );
    await DestinationERC1155MintableInstance.write.grantRole([
      await DestinationERC1155MintableInstance.read.MINTER_ROLE(),
      DestinationERC1155HandlerInstance.address
    ]);
    await OriginBridgeInstance.write.adminSetResource([
      OriginERC1155HandlerInstance.address,
      originResourceID,
      OriginERC1155MintableInstance.address,
      emptySetResourceData
    ]);
    await DestinationBridgeInstance.write.adminSetResource([
      DestinationERC1155HandlerInstance.address,
      destinationResourceID,
      DestinationERC1155MintableInstance.address,
      emptySetResourceData
    ]);
    await DestinationBridgeInstance.write.adminSetBurnable([
      DestinationERC1155HandlerInstance.address,
      DestinationERC1155MintableInstance.address
    ]);

    originDepositData = createERC1155DepositData(
      [tokenID],
      [depositAmount]
    );
    originDepositProposalData = createERC1155DepositProposalData(
      [tokenID],
      [depositAmount],
      recipient.account!.address,
      "0x"
    );

    destinationDepositData = createERC1155DepositData(
      [tokenID],
      [depositAmount]
    );
    destinationDepositProposalData = createERC1155DepositProposalData(
      [tokenID],
      [depositAmount],
      depositor.account!.address,
      "0x"
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

  it("[sanity] depositor' balance of tokenID should be equal to initialTokenAmount", async () => {
    const depositorBalance = await OriginERC1155MintableInstance.read.balanceOf([
      depositor.account!.address,
      tokenID
    ]);
    assert.strictEqual(depositorBalance, initialTokenAmount);
  });

  it(`[sanity] DestinationERC1155HandlerInstance.address should have
      minterRole for DestinationERC1155MintableInstance`, async () => {
    const isMinter = await DestinationERC1155MintableInstance.read.hasRole([
      await DestinationERC1155MintableInstance.read.MINTER_ROLE(),
      DestinationERC1155HandlerInstance.address
    ]);
    assert.isTrue(isMinter);
  });

  it(`E2E: tokenID of Origin ERC1155 owned by depositAddress to Destination ERC1155
      owned by recipient and back again`, async () => {
    const originProposalSignedData = await signTypedProposal(
      DestinationBridgeInstance.address,
      [originDomainProposal]
    );
    const destinationProposalSignedData = await signTypedProposal(
      OriginBridgeInstance.address,
      [destinationDomainProposal]
    );

    let depositorBalance;
    let recipientBalance;

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

    depositorBalance = await OriginERC1155MintableInstance.read.balanceOf([
      depositor.account!.address,
      tokenID
    ]);
    assert.strictEqual(
      depositorBalance,
      initialTokenAmount - depositAmount
    );

    // destinationRelayer1 executes the proposal
    await expect(
      DestinationBridgeInstance.write.executeProposal([
        originDomainProposal,
        originProposalSignedData],
        {account: destinationRelayer1.account}
      )
    ).not.to.be.reverted;

    depositorBalance = await OriginERC1155MintableInstance.read.balanceOf([
      depositor.account!.address,
      tokenID
    ]);
    assert.strictEqual(
      depositorBalance,
      initialTokenAmount - depositAmount,
      "depositAmount wasn't transferred from depositor"
    );

    recipientBalance = await DestinationERC1155MintableInstance.read.balanceOf([
      recipient.account!.address,
      tokenID
    ]);
    assert.strictEqual(
      recipientBalance,
      depositAmount,
      "depositAmount wasn't transferred to recipient"
    );

    await DestinationERC1155MintableInstance.write.setApprovalForAll([
      DestinationERC1155HandlerInstance.address,
      true],
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

    // Recipient should have a balance of 0 (deposit amount - deposit amount)
    recipientBalance = await DestinationERC1155MintableInstance.read.balanceOf([
      recipient.account!.address,
      tokenID
    ]);
    assert.strictEqual(recipientBalance, BigInt(0));

    // originRelayer1 executes the proposal
    await expect(
      OriginBridgeInstance.write.executeProposal([
        destinationDomainProposal,
        destinationProposalSignedData],
        {account: originRelayer1.account}
      )
    ).not.to.be.reverted;
    recipientBalance = await DestinationERC1155MintableInstance.read.balanceOf([
      recipient.account!.address,
      tokenID
    ]);
    assert.strictEqual(recipientBalance, BigInt(0));

    depositorBalance = await OriginERC1155MintableInstance.read.balanceOf([
      depositor.account!.address,
      tokenID
    ]);
    assert.strictEqual(depositorBalance, initialTokenAmount);
  });
});
