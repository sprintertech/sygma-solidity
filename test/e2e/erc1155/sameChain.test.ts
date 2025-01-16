// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from "hardhat";
import {assert, expect} from "chai";
import {encodeAbiParameters, Hex, keccak256, parseAbiParameters, parseEther, parseUnits, WalletClient,  concat, toHex} from "viem";
import {ContractTypesMap} from "hardhat/types";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {Proposal} from "../../../types";
import { deploySourceChainContracts, deployDestinationChainContracts, mpcAddress, signTypedProposal, createERC1155DepositData, createERC1155DepositProposalData, createResourceID} from "../../helpers";



describe("E2E ERC1155 - Same Chain", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;
  const tokenID = BigInt(1);
  const initialTokenAmount = BigInt(100);
  const depositAmount = BigInt(10);
  const expectedDepositNonce = BigInt(1);
  const feeData = "0x";
  const emptySetResourceData = "0x";


  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC1155MintableInstance: ContractTypesMap["ERC1155PresetMinterPauser"];
  let ERC1155HandlerInstance: ContractTypesMap["ERC1155Handler"];
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
      ERC1155MintableInstance,
      ERC1155HandlerInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      admin,
      depositor,
      recipient,
      relayer1,
    ] = await hre.viem.getWalletClients();

    resourceID = createResourceID(
      ERC1155MintableInstance.address,
      originDomainID
    );

    await ERC1155MintableInstance.write.mintBatch([
      depositor.account!.address,
      [tokenID],
      [initialTokenAmount],
      "0x00"
    ]);
    await BridgeInstance.write.adminSetResource([
      ERC1155HandlerInstance.address,
      resourceID,
      ERC1155MintableInstance.address,
      emptySetResourceData
    ]);

    await ERC1155MintableInstance.write.setApprovalForAll([
      ERC1155HandlerInstance.address,
      true],
      {account: depositor.account}
    );

    depositData = createERC1155DepositData([tokenID], [depositAmount]);
    proposalData = createERC1155DepositProposalData(
      [tokenID],
      [depositAmount],
      recipient.account!.address,
      "0x"
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

  it("[sanity] depositor' balance should be equal to initialTokenAmount", async () => {
    const depositorBalance = await ERC1155MintableInstance.read.balanceOf([
      depositor.account!.address,
      tokenID
    ]);
    assert.strictEqual(depositorBalance, initialTokenAmount);
  });

  it("depositAmount of Destination ERC1155 should be transferred to recipient", async () => {
    const proposalSignedData = signTypedProposal(
      BridgeInstance.address,
      [proposal]
    );

    // depositor makes initial deposit of depositAmount
    await expect(
      BridgeInstance.write.deposit([originDomainID, resourceID, depositData, feeData], {
        account: depositor.account,
      })
    ).not.to.be.reverted;

    // Handler should have a balance of depositAmount
    const handlerBalance = await ERC1155MintableInstance.read.balanceOf([
      ERC1155HandlerInstance.address,
      tokenID
    ]);
    assert.strictEqual(handlerBalance, depositAmount);

    // relayer1 executes the proposal
    await expect(
      BridgeInstance.write.executeProposal([proposal, proposalSignedData], {
        account: relayer1.account,
      })
    ).not.to.be.reverted;

    // Assert ERC1155 balance was transferred from depositor
    const depositorBalance = await ERC1155MintableInstance.read.balanceOf([
      depositor.account!.address,
      tokenID
    ]);
    assert.strictEqual(
      depositorBalance,
      initialTokenAmount - depositAmount
    );

    // Assert ERC1155 balance was transferred to recipient
    const recipientBalance = await ERC1155MintableInstance.read.balanceOf([
      recipient.account!.address,
      tokenID
    ]);
    assert.strictEqual(recipientBalance, depositAmount);
  });

  it("Handler's deposit function can be called by only bridge", async () => {
    await expect(
      ERC1155HandlerInstance.write.deposit([
        resourceID,
        depositor.account!.address,
        depositData],
        {account: depositor.account}
      ),
    ).to.be.rejectedWith("sender must be bridge contract");
  });

  it("Handler's executeProposal function can be called by only bridge", async () => {
    await expect(
      ERC1155HandlerInstance.write.executeProposal([resourceID, proposalData], {
        account: depositor.account,
      }),
    ).to.be.revertedWith("sender must be bridge contract");
  });

  it("Handler's withdraw function can be called only by authorized address", async () => {
    const withdrawData = createERC1155WithdrawData(
      ERC1155MintableInstance.address,
      depositor.account!.address,
      [tokenID],
      [depositAmount],
      "0x"
    );

    await expect(
      ERC1155HandlerInstance.write.withdraw([withdrawData], {account: depositor.account}),
    ).to.be.revertedWithCustomError(BridgeInstance, "NotAuthorized()");
  });

  it("Should withdraw funds", async () => {
    let depositorBalance;

    depositorBalance = await ERC1155MintableInstance.read.balanceOf([
      depositor.account!.address,
      tokenID
    ]);
    assert.equal(depositorBalance, initialTokenAmount);

    await ERC1155MintableInstance.write.safeTransferFrom([
      depositor.account!.address,
      ERC1155HandlerInstance.address,
      tokenID,
      depositAmount,
      "0x00"],
      {account: depositor.account}
    );

    depositorBalance = await ERC1155MintableInstance.read.balanceOf([
      depositor.account!.address,
      tokenID
    ]);
    assert.equal(
      depositorBalance,
      initialTokenAmount - depositAmount
    );

    const handlerBalance = await ERC1155MintableInstance.read.balanceOf([
      ERC1155HandlerInstance.address,
      tokenID
    ]);
    assert.equal(handlerBalance, depositAmount);

    const withdrawData = createERC1155WithdrawData(
      ERC1155MintableInstance.address,
      depositor.account!.address,
      [tokenID],
      [depositAmount],
      "0x"
    );

    await BridgeInstance.write.adminWithdraw([
      ERC1155HandlerInstance.address,
      withdrawData
    ]);

    depositorBalance = await ERC1155MintableInstance.read.balanceOf([
      depositor.account!.address,
      tokenID
    ]);
    assert.equal(depositorBalance, initialTokenAmount);
  });
});
