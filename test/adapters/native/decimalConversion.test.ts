// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from "hardhat";
import {assert, expect} from "chai";
import {encodeAbiParameters, Hex, keccak256, parseAbiParameters, parseEther, parseUnits, WalletClient,  concat, toHex} from "viem";
import {createBtcDepositData, createERCDepositData, deploySourceChainContracts, getBalance, mpcAddress, signTypedProposal, trimPrefix} from "../../helpers";
import {ContractTypesMap} from "hardhat/types";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {Proposal} from "../../../types";


describe("Bridge - [decimal conversion - native token]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;

  const expectedDepositNonce = BigInt(1);
  const resourceID = toHex(650, {size:32});
  const btcrecipient = "bc1qs0fcdq73vgurej48yhtupzcv83un2p5qhsje7n";
  const originDecimalPlaces = 8;
  const originHexDecimalPlaces = toHex(originDecimalPlaces);
  const depositAmount = parseUnits("1", originDecimalPlaces);
  const fee = parseUnits("0.1", originDecimalPlaces);
  const transferredAmount = depositAmount - fee;
  const convertedTransferAmount = parseEther("0.9");

  const expectedDepositData = createBtcDepositData(transferredAmount, btcrecipient);
  const expectedHandlerResponse = encodeAbiParameters(
    parseAbiParameters("uint256"),
    [convertedTransferAmount]
  );

  let BridgeInstance: ContractTypesMap["Bridge"];
  let DefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];
  let NativeTokenHandlerInstance: ContractTypesMap["NativeTokenHandler"];
  let BasicFeeHandlerInstance: ContractTypesMap["BasicFeeHandler"];
  let FeeHandlerRouterInstance: ContractTypesMap["FeeHandlerRouter"];
  let NativeTokenTransferGatewayInstance: ContractTypesMap["NativeTokenTransferGateway"];

  let admin: WalletClient;
  let depositor: WalletClient;
  let evmRecipient: WalletClient;
  let relayer1: WalletClient;

  let depositProposalData: Hex;
  let proposal: Proposal;

  beforeEach(async () => {
    ({
      DefaultMessageReceiverInstance,
      BridgeInstance,
      NativeTokenHandlerInstance,
      BasicFeeHandlerInstance,
      FeeHandlerRouterInstance,
      NativeTokenTransferGatewayInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      admin,
      depositor,
      evmRecipient,
      relayer1
    ] = await hre.viem.getWalletClients();

    await BridgeInstance.write.adminSetResource([
        NativeTokenHandlerInstance.address,
        resourceID,
        NativeTokenHandlerInstance.address,
        originHexDecimalPlaces
      ]);
    await BasicFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);
    await BridgeInstance.write.adminChangeFeeHandler([FeeHandlerRouterInstance.address]);
    await FeeHandlerRouterInstance.write.adminSetResourceHandler([
      destinationDomainID,
      resourceID,
      BasicFeeHandlerInstance.address
    ]);

    depositProposalData = createBtcDepositData(
      transferredAmount,
      btcrecipient
    );

    proposal = {
      originDomainID: originDomainID,
      depositNonce: expectedDepositNonce,
      resourceID: resourceID,
      data: depositProposalData,
    };

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);

    // send ETH to destination adapter for transfers

    await depositor.sendTransaction({
      account: depositor!.account,
      to: NativeTokenHandlerInstance.address,
      value: BigInt(1000000000000000000),
      chain: null
    })
  });


  it("[sanity] decimals value is set if args are provided to 'adminSetResource'", async () => {
    const NativeTokenDecimals = (await NativeTokenHandlerInstance.read._tokenContractAddressToTokenProperties([
      NativeTokenHandlerInstance.address
    ]))[3];

    assert.strictEqual(NativeTokenDecimals.isSet, true);
    assert.strictEqual(NativeTokenDecimals["externalDecimals"], 8);
  });

  it("Deposit converts sent token amount with 8 decimals to 18 decimal places", async () => {
    const depositTx = await NativeTokenTransferGatewayInstance.write.deposit([destinationDomainID, btcrecipient], {
      account: depositor.account?.address,
      value: depositAmount
    })

    await expect(depositTx).not.to.be.reverted;

    await expect(depositTx).to.emit(BridgeInstance, "Deposit").withArgs(
      destinationDomainID,
      resourceID.toLowerCase(),
      expectedDepositNonce,
      NativeTokenTransferGatewayInstance.address,
      expectedDepositData,
      expectedHandlerResponse
    )
  });

  it("Proposal execution converts sent token amount with 18 decimals to 8 decimal places", async () => {
    const expectedRecipientTransferAmount = parseUnits("0.9", originDecimalPlaces);
    const proposalData = createERCDepositData(
      convertedTransferAmount, // 18 decimals
      20,
      evmRecipient.account!.address
    );

    const dataHash = keccak256(
      concat([
        NativeTokenHandlerInstance.address,
        trimPrefix(proposalData)
      ])
    );

    const proposal = {
      originDomainID: originDomainID,
      depositNonce: expectedDepositNonce,
      resourceID: resourceID,
      data: proposalData,
    };

    const proposalSignedData = await signTypedProposal(
      BridgeInstance.address,
      [proposal]
    );

    const recipientBalanceBefore = await getBalance(evmRecipient);

    const proposalTx = await BridgeInstance.write.executeProposal([
      proposal,
      proposalSignedData,
    ],
    {
      account: relayer1.account
    }
    );

    await expect(proposalTx).to.emit(BridgeInstance, "FundsTransferred").withArgs(
      expectedRecipientTransferAmount
    )

    await expect(proposalTx).to.emit(BridgeInstance, "ProposalExecution").withArgs(
      originDomainID,
      expectedDepositNonce,
      dataHash,
      encodeAbiParameters(
        parseAbiParameters(["address", "address", "uint256"]),
        [NativeTokenHandlerInstance.address, evmRecipient.account!.address, expectedRecipientTransferAmount]
      )
    )

    // check that deposit nonce has been marked as used in bitmap
    assert.isTrue(
      await BridgeInstance.read.isProposalExecuted([
        originDomainID,
        expectedDepositNonce
      ])
    );

    // check that tokens are transferred to recipient address
    const recipientBalanceAfter = await getBalance(evmRecipient);
    assert.strictEqual(transferredAmount + recipientBalanceBefore, recipientBalanceAfter);
  });
});
