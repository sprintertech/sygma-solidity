// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from "hardhat";
import {assert, expect} from "chai";
import {encodeAbiParameters, Hex, keccak256, parseAbiParameters, parseEther, parseUnits, WalletClient,  concat, toHex} from "viem";
import {createBtcDepositData, createResourceID, createERCDepositData, deploySourceChainContracts, deployDestinationChainContracts, getBalance, mpcAddress, signTypedProposal, trimPrefix, createDepositProposalDataFromHandlerResponse} from "../../helpers";
import {ContractTypesMap} from "hardhat/types";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {Proposal} from "../../../types";

describe("E2E ERC20 - Same Chain", () => {
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
  let DefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];


  let admin: WalletClient;
  let depositor: WalletClient;
  let recipient: WalletClient;
  let relayer1: WalletClient;

  let resourceID: Hex;
  let depositData: Hex;
  let depositProposalData: Hex;
  let proposal: Proposal;
  let depositProposalDataHash: Hex;

  beforeEach(async () => {
    ({
      DefaultMessageReceiverInstance,
      BridgeInstance,
      ERC20MintableInstance,
      ERC20HandlerInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      admin,
      depositor,
      recipient,
      relayer1,
    ] = await hre.viem.getWalletClients();

    resourceID = createResourceID(
      ERC20MintableInstance.address,
      originDomainID
    );

    await ERC20MintableInstance.write.mint([depositor.account!.address, initialTokenAmount]),
    await BridgeInstance.write.adminSetResource([
      ERC20HandlerInstance.address,
      resourceID,
      ERC20MintableInstance.address,
      emptySetResourceData
    ]);

    await ERC20MintableInstance.write.approve([
      ERC20HandlerInstance.address,
      depositAmount],
      {account: depositor.account}
    );

    depositData = createERCDepositData(
      depositAmount,
      20,
      recipient
    );
    depositProposalData = createERCDepositData(
      depositAmount,
      20,
      recipient
    );
    depositProposalDataHash = keccak256(
      concat([
        ERC20HandlerInstance.address,
        trimPrefix(depositProposalData)
      ])
    );

    proposal = {
      originDomainID: originDomainID,
      depositNonce: expectedDepositNonce,
      data: depositProposalData,
      resourceID: resourceID,
    };

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("[sanity] depositor' balance should be equal to initialTokenAmount", async () => {
    const depositorBalance = await ERC20MintableInstance.read.balanceOf([
      depositor.account!.address
    ]);
    assert.strictEqual(depositorBalance, initialTokenAmount);
  });

  it(`[sanity] ERC20HandlerInstance.address should have
    an allowance of depositAmount from depositor`, async () => {
    const handlerAllowance = await ERC20MintableInstance.read.allowance([
      depositor.account!.address,
      ERC20HandlerInstance.address
    ]);
    assert.strictEqual(handlerAllowance, depositAmount);
  });

  it("depositAmount of Destination ERC20 should be transferred to recipient", async () => {
    const proposalSignedData = await signTypedProposal(
      BridgeInstance.address,
      [proposal]
    );

    // depositor makes initial deposit of depositAmount
    assert.isFalse(await BridgeInstance.read.paused());
    await expect(
      BridgeInstance.write.deposit([originDomainID, resourceID, depositData, feeData], {
        account: depositor.account,
      })
    ).not.to.be.reverted;

    // Handler should have a balance of depositAmount
    const handlerBalance = await ERC20MintableInstance.read.balanceOf([
      ERC20HandlerInstance.address
    ]);
    assert.strictEqual(handlerBalance, depositAmount);

    // relayer2 executes the proposal
    await expect(
      BridgeInstance.write.executeProposal([proposal, proposalSignedData], {
        account: relayer1.account,
      })
    ).not.to.be.reverted;

    // Assert ERC20 balance was transferred from depositor
    const depositorBalance = await ERC20MintableInstance.read.balanceOf([
      depositor.account!.address
    ]);
    assert.strictEqual(
      depositorBalance,
      initialTokenAmount - depositAmount
    );

    // // Assert ERC20 balance was transferred to recipient
    const recipientBalance = await ERC20MintableInstance.read.balanceOf([
      recipient.account!.address
    ]);
    assert.strictEqual(recipientBalance, depositAmount);
  });
});
