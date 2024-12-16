// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from "hardhat";
import {assert, expect} from "chai";
import {encodeAbiParameters, Hex, keccak256, parseAbiParameters, parseEther, parseUnits, WalletClient,  concat, toHex} from "viem";
import {createBtcDepositData, createERCDepositData, deploySourceChainContracts, deployDestinationChainContracts, getBalance, mpcAddress, signTypedProposal, trimPrefix, createDepositProposalDataFromHandlerResponse} from "../../../helpers";
import {ContractTypesMap} from "hardhat/types";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {Proposal} from "../../../types";
import {createResourceID} from "../../../helpers";

describe("E2E ERC20 - Two EVM Chains both with decimal places != 18 with rounding loss", () => {
    const originDomainID = 1;
    const destinationDomainID = 2;

    const originDecimalPlaces = 20;
    const destinationDecimalPlaces = 14;
    const bridgeDefaultDecimalPlaces = 18;
    const initialTokenAmount = parseUnits("100", originDecimalPlaces);
    const originDepositAmount = parseUnits("1.00000000000000005683", originDecimalPlaces);
    const destinationDepositAmount = parseUnits("1", destinationDecimalPlaces);
    const originRelayerConvertedAmount = parseUnits("1.000000000000000056", bridgeDefaultDecimalPlaces);
    const destinationRelayerConvertedAmount = parseUnits("1", bridgeDefaultDecimalPlaces);
    const roundingLoss = originDepositAmount - parseUnits("1", originDecimalPlaces);
    const expectedDepositNonce = BigInt(1);
    const feeData = "0x";

    let OriginBridgeInstance: ContractTypesMap["Bridge"];
    let OriginERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];
    let OriginDefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];
    let OriginERC20HandlerInstance: ContractTypesMap["ERC20Handler"];

    let originDepositData: Hex;
    let originResourceID: Hex;;

    let DestinationBridgeInstance: ContractTypesMap["Bridge"];;
    let DestinationERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];
    let DestinationDefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];
    let DestinationERC20HandlerInstance: ContractTypesMap["ERC20Handler"];

    let destinationDepositData: Hex;
    let destinationResourceID: Hex;

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

        originResourceID = createResourceID(OriginERC20MintableInstance.address, originDomainID);
        destinationResourceID = createResourceID(DestinationERC20MintableInstance.address, originDomainID);

        await OriginERC20MintableInstance.write.mint([depositor.account!.address, initialTokenAmount]);

        await OriginERC20MintableInstance.write.approve([
          OriginERC20HandlerInstance.address,
          originDepositAmount],
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
          DestinationERC20MintableInstance.address,
          // set decimal places for handler and token
          toHex(originDecimalPlaces)
        ]);
        await OriginBridgeInstance.write.adminSetBurnable([
          OriginERC20HandlerInstance.address,
          OriginERC20MintableInstance.address
        ]);
        await DestinationBridgeInstance.write.adminSetResource([
          DestinationERC20HandlerInstance.address,
          destinationResourceID,
          DestinationERC20MintableInstance.address,
          // set decimal places for handler and token
          toHex(destinationDecimalPlaces)
        ]);
        await DestinationBridgeInstance.write.adminSetBurnable([
          DestinationERC20HandlerInstance.address,
          DestinationERC20MintableInstance.address
        ]);

        originDepositData = createERCDepositData(originDepositAmount, 20, recipient.account!.address);
        destinationDepositData = createERCDepositData(destinationDepositAmount, 20, depositor.account!.address);

        // set MPC address to unpause the Bridge
        await OriginBridgeInstance.write.endKeygen([mpcAddress]);
        await DestinationBridgeInstance.write.endKeygen([mpcAddress]);
    });

    it("[sanity] check token contract decimals match set decimals on handlers", async () => {
      const originTokenContractDecimals = (await OriginERC20MintableInstance.read.decimals());
      const originDecimalsSetOnHandler =  (
        await OriginERC20HandlerInstance.read._tokenContractAddressToTokenProperties([
          OriginERC20MintableInstance.address
      ]))[3]

      const destinationTokenContractDecimals = (await DestinationERC20MintableInstance.read.decimals());
      const destinationDecimalsSetOnHandler =  (await DestinationERC20HandlerInstance.read
        ._tokenContractAddressToTokenProperties([DestinationERC20MintableInstance.address
      ]))[3];

      assert.strictEqual(
        originTokenContractDecimals,
        originDecimalsSetOnHandler["externalDecimals"]
      );
      assert.strictEqual(
        destinationTokenContractDecimals,
        destinationDecimalsSetOnHandler["externalDecimals"]
      );
    });

    it(`E2E: depositAmount of Origin ERC20 owned by depositAddress to Destination ERC20
        owned by recipient and back again`, async () => {


        let depositorBalance;
        let recipientBalance;

        // depositor makes initial deposit of depositAmount
        const originDepositTx = await OriginBridgeInstance.write.deposit([
          destinationDomainID,
          originResourceID,
          originDepositData,
          feeData],
          {account: depositor.account}
        );
        await expect(originDepositTx).not.to.be.reverted;


        // check that deposited amount converted to 18 decimal places is
        // emitted in handlerResponse
        await expect(originDepositTx).to.emit(OriginBridgeInstance, "Deposit").withArgs(
          destinationDomainID,
          originResourceID.toLowerCase(),
          expectedDepositNonce,
          originDepositData.toLowerCase(),
          toHex(originRelayerConvertedAmount, {size: 32})
        );
        // this mocks depositProposal data for executing on
        // destination chain which is returned from relayers
        const originDepositProposalData = createDepositProposalDataFromHandlerResponse(
          originDepositTx,
          20,
          recipient
        );

        const originDomainProposal = {
          originDomainID: originDomainID,
          depositNonce: expectedDepositNonce,
          data: originDepositProposalData,
          resourceID: destinationResourceID
        };

        const originProposalSignedData = await signTypedProposal(
          DestinationBridgeInstance.address,
          [originDomainProposal]
        );

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
          initialTokenAmount - originDepositAmount,
          "originDepositAmount wasn't transferred from depositor"
        );

        // Assert ERC20 balance was transferred to recipient
        recipientBalance = await DestinationERC20MintableInstance.read.balanceOf([
          recipient.account!.address
        ]);
        assert.strictEqual(
          recipientBalance.toString(),
          destinationDepositAmount.toString(),
          "originDepositAmount wasn't transferred to recipient"
        );

        // At this point a representation of OriginERC20Mintable has been transferred from
        // depositor to the recipient using Both Bridges and DestinationERC20Mintable.
        // Next we will transfer DestinationERC20Mintable back to the depositor

        await DestinationERC20MintableInstance.write.approve([
          DestinationERC20HandlerInstance.address,
          destinationDepositAmount],
          {account: recipient.account}
        );

        // recipient makes a deposit of the received depositAmount
        const destinationDepositTx = await DestinationBridgeInstance.write.deposit([
          originDomainID,
          destinationResourceID,
          destinationDepositData,
          feeData],
          {account: recipient.account}
        );
        await expect(destinationDepositTx).not.to.be.reverted;

        // check that deposited amount converted to 18 decimal places is
        // emitted in handlerResponse
        await expect(destinationDepositTx).to.emit(DestinationBridgeInstance, "Deposit").withArgs(
          originDomainID,
          destinationResourceID.toLowerCase(),
          expectedDepositNonce,
          destinationDepositData.toLowerCase(),
          toHex(destinationRelayerConvertedAmount, {size: 32})
        );

        // this mocks depositProposal data for executing on
        // destination chain which is returned from relayers
        const destinationDepositProposalData = createDepositProposalDataFromHandlerResponse(
          destinationDepositTx,
          20,
          depositor
        );

        const destinationDomainProposal = {
          originDomainID: destinationDomainID,
          depositNonce: expectedDepositNonce,
          data: destinationDepositProposalData,
          resourceID: originResourceID
        };

        const destinationProposalSignedData = await signTypedProposal(
          OriginBridgeInstance.address,
          [destinationDomainProposal]
        );

        // Recipient should have a balance of 0 (deposit amount)
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

        // Assert ERC20 balance was transferred to recipient minus the roundingLoss
        depositorBalance = await OriginERC20MintableInstance.read.balanceOf([
          depositor.account!.address
        ]);
        assert.strictEqual(depositorBalance, initialTokenAmount - roundingLoss);
    });
});
