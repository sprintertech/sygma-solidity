// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from "hardhat";
import {assert, expect} from "chai";
import {encodeAbiParameters, Hex, keccak256, parseAbiParameters, parseEther, parseUnits, WalletClient,  concat, toHex} from "viem";
import {createBtcDepositData, createResourceID, createERCDepositData, deploySourceChainContracts, deployDestinationChainContracts, getBalance, mpcAddress, signTypedProposal, trimPrefix, createDepositProposalDataFromHandlerResponse} from "../../helpers";
import {ContractTypesMap} from "hardhat/types";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {Proposal} from "../../../types";


describe("E2E ERC20 - Two EVM Chains", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;
  const initialTokenAmount = BigInt(100);
  const depositAmount = BigInt(10);
  const expectedDepositNonce = BigInt(1);
  const feeData = "0x";
  const emptySetResourceData = "0x";

  let OriginBridgeInstance: ContractTypesMap["Bridge"];
  let OriginERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];
  let OriginDefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];
  let OriginERC20HandlerInstance: ContractTypesMap["ERC20Handler"];

  let originDepositProposalData: Hex;
  let originDepositData: Hex;
  let originResourceID: Hex;;
  let originDomainProposal: Proposal;
  let originDepositProposalDataHash: Hex;

  let DestinationBridgeInstance: ContractTypesMap["Bridge"];;
  let DestinationERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];
  let DestinationDefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];
  let DestinationERC20HandlerInstance: ContractTypesMap["ERC20Handler"];

  let destinationDepositData: Hex;
  let destinationDepositProposalData: Hex;
  let destinationResourceID: Hex;
  let destinationDepositProposalDataHash: Hex;
  let destinationDomainProposal: Proposal;

  let admin: WalletClient;
  let depositor: WalletClient;
  let recipient: WalletClient;
  let originRelayer1: WalletClient;
  let destinationRelayer1: WalletClient;

  beforeEach(async () => {
    ({
      DefaultMessageReceiverInstance: OriginDefaultMessageReceiverInstance,
      BridgeInstance: OriginBridgeInstance,
      ERC20MintableInstance: OriginERC20MintableInstance,
      ERC20HandlerInstance: OriginERC20HandlerInstance,
    } = await loadFixture(deploySourceChainContracts));
    ({
      DefaultMessageReceiverInstance: DestinationDefaultMessageReceiverInstance,
      BridgeInstance: DestinationBridgeInstance,
      ERC20MintableInstance: DestinationERC20MintableInstance,
      ERC20HandlerInstance: DestinationERC20HandlerInstance,
    } = await loadFixture(deployDestinationChainContracts));
    [
      admin,
      depositor,
      recipient,
      originRelayer1,
      destinationRelayer1,
    ] = await hre.viem.getWalletClients();

    originResourceID = createResourceID(
      OriginERC20MintableInstance.address,
      originDomainID
    );
    destinationResourceID = createResourceID(
      DestinationERC20MintableInstance.address,
      originDomainID
    );

    await OriginERC20MintableInstance.write.mint([
      depositor.account!.address,
      initialTokenAmount
    ]);

    await OriginERC20MintableInstance.write.approve([
      OriginERC20HandlerInstance.address,
      depositAmount],
      {account: depositor.account}
    );
    await OriginERC20MintableInstance.write.grantRole([
      await OriginERC20MintableInstance.read.MINTER_ROLE(),
      OriginERC20HandlerInstance.address
    ]);
    await DestinationERC20MintableInstance.write.grantRole([
      await DestinationERC20MintableInstance.read.MINTER_ROLE(),
      DestinationERC20HandlerInstance.address
    ]);
    await OriginBridgeInstance.write.adminSetResource([
      OriginERC20HandlerInstance.address,
      originResourceID,
      OriginERC20MintableInstance.address,
      emptySetResourceData
    ]);
    await OriginBridgeInstance.write.adminSetBurnable([
      OriginERC20HandlerInstance.address,
      OriginERC20MintableInstance.address
    ]);
    await DestinationBridgeInstance.write.adminSetResource([
      DestinationERC20HandlerInstance.address,
      destinationResourceID,
      DestinationERC20MintableInstance.address,
      emptySetResourceData
    ]);
    await DestinationBridgeInstance.write.adminSetBurnable([
      DestinationERC20HandlerInstance.address,
      DestinationERC20MintableInstance.address
    ]);

    originDepositData = createERCDepositData(
      depositAmount,
      20,
      recipient
    );
    originDepositProposalData = createERCDepositData(
      depositAmount,
      20,
      recipient
    );
    originDepositProposalDataHash = keccak256(
      concat([
        DestinationERC20HandlerInstance.address,
        trimPrefix(originDepositProposalData)
      ])
    );

    destinationDepositData = createERCDepositData(
      depositAmount,
      20,
      depositor
    );
    destinationDepositProposalData = createERCDepositData(
      depositAmount,
      20,
      depositor
    );
    destinationDepositProposalDataHash = keccak256(
      concat([
        OriginERC20HandlerInstance.address,
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

  it("[sanity] depositor' balance should be equal to initialTokenAmount", async () => {
    const depositorBalance = await OriginERC20MintableInstance.read.balanceOf([
      depositor.account!.address
    ]);
    assert.strictEqual(depositorBalance, initialTokenAmount);
  });

  it(`[sanity] OriginERC20HandlerInstance.address should
    have an allowance of depositAmount from depositor`, async () => {
    const handlerAllowance = await OriginERC20MintableInstance.read.allowance([
      depositor.account!.address,
      OriginERC20HandlerInstance.address
    ]);
    assert.strictEqual(handlerAllowance, depositAmount);
  });

  it(`[sanity] DestinationERC20HandlerInstance.address should
    have minterRole for DestinationERC20MintableInstance`, async () => {
    const isMinter = await DestinationERC20MintableInstance.read.hasRole([
      await DestinationERC20MintableInstance.read.MINTER_ROLE(),
      DestinationERC20HandlerInstance.address
    ]);
    assert.isTrue(isMinter);
  });

  it(`E2E: depositAmount of Origin ERC20 owned by depositAddress to Destination ERC20
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

    // depositor makes initial deposit of depositAmount
    await expect(
      OriginBridgeInstance.write.deposit([
        destinationDomainID,
        originResourceID,
        originDepositData,
        feeData],
        {account: depositor.account}
      )
    ).not.to.be.reverted;

    // destinationRelayer1 executes the proposal
    await expect(
      DestinationBridgeInstance.write.executeProposal([
        originDomainProposal,
        originProposalSignedData],
        {account: destinationRelayer1.account}
      )
    ).not.to.be.reverted;

    // Assert ERC20 balance was transferred from depositor
    depositorBalance = await OriginERC20MintableInstance.read.balanceOf([
      depositor.account!.address
    ]);
    assert.strictEqual(
      depositorBalance,
      initialTokenAmount - depositAmount,
      "depositAmount wasn't transferred from depositor"
    );

    // Assert ERC20 balance was transferred to recipient
    recipientBalance = await DestinationERC20MintableInstance.read.balanceOf([
      recipient.account!.address
    ]);
    assert.strictEqual(
      recipientBalance,
      depositAmount,
      "depositAmount wasn't transferred to recipient"
    );

    // At this point a representation of OriginERC20Mintable has been transferred from
    // depositor to the recipient using Both Bridges and DestinationERC20Mintable.
    // Next we will transfer DestinationERC20Mintable back to the depositor

    await DestinationERC20MintableInstance.write.approve([
      DestinationERC20HandlerInstance.address,
      depositAmount],
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
    recipientBalance = await DestinationERC20MintableInstance.read.balanceOf([
      recipient.account!.address
    ]);
    assert.strictEqual(recipientBalance, BigInt(0));

    // destinationRelayer1 executes the proposal
    await expect(
      OriginBridgeInstance.write.executeProposal([
        destinationDomainProposal,
        destinationProposalSignedData],
        {account: originRelayer1.account}
      )
    ).not.to.be.reverted;

    // Assert ERC20 balance was transferred from recipient
    recipientBalance = await DestinationERC20MintableInstance.read.balanceOf([
      recipient.account!.address
    ]);
    assert.strictEqual(recipientBalance, BigInt(0));

    // Assert ERC20 balance was transferred to recipient
    depositorBalance = await OriginERC20MintableInstance.read.balanceOf([
      depositor.account!.address
    ]);
    assert.strictEqual(depositorBalance, initialTokenAmount);
  });
});
