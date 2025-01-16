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


describe("E2E ERC20 - Two EVM Chains, one with decimal places == 18, other with == 0", () => {
    const originDomainID = 1;
    const destinationDomainID = 2;

    const originDecimalPlaces = 0;
    const destinationDecimalPlaces = 18;
    const bridgeDefaultDecimalPlaces = 18;
    const initialTokenAmount = BigInt(10000000000000000);
    const originDepositAmount = BigInt(1400000000000000);
    const destinationDepositAmount = parseUnits(originDepositAmount.toString(), destinationDecimalPlaces);
    const relayerConvertedAmount = parseUnits(originDepositAmount.toString(), bridgeDefaultDecimalPlaces);
    const expectedDepositNonce = BigInt(1);
    const feeData = "0x";
    const emptySetResourceData = "0x";


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
    let destinationDepositProposalData: Hex;
    let destinationResourceID: Hex;

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
          OriginERC20MintableInstance.address,
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
          emptySetResourceData
        ]);
        await DestinationBridgeInstance.write.adminSetBurnable([
          DestinationERC20HandlerInstance.address,
          DestinationERC20MintableInstance.address,
        ]);

        originDepositData = createERCDepositData(originDepositAmount, 20, recipient.account!.address);

        destinationDepositData = createERCDepositData(destinationDepositAmount, 20, depositor.account!.address);
        destinationDepositProposalData = createERCDepositData(relayerConvertedAmount, 20, depositor.account!.address);

        destinationDomainProposal = {
          originDomainID: destinationDomainID,
          depositNonce: expectedDepositNonce,
          data: destinationDepositProposalData,
          resourceID: originResourceID
        };

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

      const destinationDecimalsSetOnHandler =  (await DestinationERC20HandlerInstance.read
        ._tokenContractAddressToTokenProperties([DestinationERC20MintableInstance.address
      ]));

      assert.strictEqual(
        originTokenContractDecimals,
        originDecimalsSetOnHandler["externalDecimals"]
      );
      assert.isFalse(destinationDecimalsSetOnHandler["isSet"][0]);
      assert.strictEqual(
        0,
        destinationDecimalsSetOnHandler["externalDecimals"]
      );
    });

    it(`E2E: depositAmount of Origin ERC20 owned by depositAddress to Destination ERC20
        owned by recipient and back again`, async () => {
        const destinationProposalSignedData = signTypedProposal(
          OriginBridgeInstance.address,
          [destinationDomainProposal]
        );

        let depositorBalance;
        let recipientBalance;

        // depositor.account!.address makes initial deposit of depositAmount
        const originDepositTx = await OriginBridgeInstance.write.deposit([
          destinationDomainID,
          originResourceID,
          originDepositData,
          feeData],
          {account: depositor.account}
        );
        await expect(originDepositTx).not.to.be.reverted;

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

        const originProposalSignedData = signTypedProposal(
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

        // Assert ERC20 balance was transferred from depositor.account!.address
        depositorBalance = await OriginERC20MintableInstance.read.balanceOf([
          depositor.account!.address
        ]);
        assert.strictEqual(
          depositorBalance,
          initialTokenAmount - originDepositAmount,
          "originDepositAmount wasn't transferred from depositor.account!.address"
        );

        // Assert ERC20 balance was transferred to recipient
        recipientBalance = await DestinationERC20MintableInstance.read.balanceOf([
          recipient.account!.address
        ]);
        assert.strictEqual(
          recipientBalance,
          destinationDepositAmount,
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
        const depositTx = await DestinationBridgeInstance.write.deposit([
          originDomainID,
          destinationResourceID,
          destinationDepositData,
          feeData],
          {account: recipient.account}
        );
        await expect(depositTx).not.to.be.reverted;

        // check that handlerResponse is empty - deposits from networks with 18 decimal
        // places shouldn't return handlerResponse
        await expect(depositTx).to.emit(OriginBridgeInstance, "Deposit").withArgs(
          originDomainID,
          destinationResourceID.toLowerCase(),
          expectedDepositNonce,
          destinationDepositData.toLowerCase(),
          null
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

        // Assert ERC20 balance was transferred to recipient
        depositorBalance = await OriginERC20MintableInstance.read.balanceOf([
          depositor.account!.address
        ]);
        assert.strictEqual(depositorBalance, initialTokenAmount);
    });
});
