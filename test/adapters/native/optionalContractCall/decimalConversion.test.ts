// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {concat, encodeAbiParameters, encodeFunctionData, Hex, keccak256, parseAbiParameters, parseEther, parseUnits, toFunctionSelector, toHex, WalletClient, zeroAddress} from "viem";
import {createGmpDepositData, createMessageCallData, createOptionalContractCallDepositData, createResourceID, deploySourceChainContracts, mpcAddress, trimPrefix} from "../../../helpers";
import {ContractTypesMap} from 'hardhat/types';
import {loadFixture} from '@nomicfoundation/hardhat-network-helpers';
import {assert, expect} from 'chai';
import {Wallet} from 'ethers';
import {Proposal} from '../../../../types';


describe("Bridge - [decimal conversion - native token]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;

  const expectedDepositNonce = BigInt(1);
  const resourceID = toHex(650, {size:32});
  const originDecimalPlaces = 8;
  const depositAmount = parseUnits("1", originDecimalPlaces);
  const fee = parseUnits("0.1", originDecimalPlaces);
  const transferredAmount = depositAmount - fee ;
  const convertedTransferAmount = parseEther("0.9");
  const transactionId = toHex(1, {size:32});
  const executionGasAmount = BigInt(30000000);

  const expectedHandlerResponse =
  encodeAbiParameters(
    parseAbiParameters(
      ["uint256"]
    ),
      [convertedTransferAmount]
  );

  let BridgeInstance: ContractTypesMap["Bridge"];
  let DefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];
  let NativeTokenHandlerInstance: ContractTypesMap["NativeTokenHandler"];
  let BasicFeeHandlerInstance: ContractTypesMap["BasicFeeHandler"];
  let FeeHandlerRouterInstance: ContractTypesMap["FeeHandlerRouter"];
  let NativeTokenTransferGatewayInstance: ContractTypesMap["NativeTokenTransferGateway"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];

  let depositor: WalletClient;
  let evmRecipient: WalletClient;
  let relayer1: WalletClient;

  let depositProposalData: Hex;
  let message: Hex;
  let proposal: Proposal;


  before(async () => {
    ({
      DefaultMessageReceiverInstance,
      BridgeInstance,
      ERC20MintableInstance,
      NativeTokenHandlerInstance,
      FeeHandlerRouterInstance,
      NativeTokenTransferGatewayInstance,
      BasicFeeHandlerInstance,
      ERC20MintableInstance
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      depositor,
      evmRecipient,
      relayer1
    ] = await hre.viem.getWalletClients();

    await BridgeInstance.write.adminSetResource([
      NativeTokenHandlerInstance.address,
      resourceID,
      zeroAddress,
      toHex(originDecimalPlaces)
    ]);
    await BasicFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);
    await BridgeInstance.write.adminChangeFeeHandler([FeeHandlerRouterInstance.address]);
    await FeeHandlerRouterInstance.write.adminSetResourceHandler([
      destinationDomainID,
      resourceID,
      BasicFeeHandlerInstance.address
    ]);

    await DefaultMessageReceiverInstance.write.grantRole([
      await DefaultMessageReceiverInstance.read.SYGMA_HANDLER_ROLE(),
      NativeTokenHandlerInstance.address
    ]);

    await ERC20MintableInstance.write.grantRole([
      await ERC20MintableInstance.read.MINTER_ROLE(),
      DefaultMessageReceiverInstance.address
    ]);

    const actionData = encodeFunctionData({
      abi: ["function mint(address to, uint256 amount)"],
      functionName: "mint",
      args: [evmRecipient, "5"]
    });

    const actions = [{
      nativeValue: BigInt(0),
      callTo: ERC20MintableInstance.address,
      approveTo: zeroAddress,
      tokenSend: zeroAddress,
      tokenReceive: zeroAddress,
      data: actionData,
    }]
    message = createMessageCallData(
      transactionId,
      actions,
      evmRecipient.account!.address
    );

    depositProposalData = createOptionalContractCallDepositData(
      transferredAmount,
      zeroAddress,
      executionGasAmount,
      message
    );

    proposal = {
      originDomainID: originDomainID,
      depositNonce: expectedDepositNonce,
      resourceID: resourceID,
      data: depositProposalData
    };

    // send ETH to destination adapter for transfers
    await web3.eth.sendTransaction({
       account: depositor.account,
      to: NativeTokenHandlerInstance.address,
      value: "1000000000000000000"
    })

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("[sanity] decimals value is set if args are provided to 'adminSetResource'", async () => {
    const NativeTokenDecimals = (await NativeTokenHandlerInstance.read._tokenContractAddressToTokenProperties([
      zeroAddress
    ]))[3];

    assert.strictEqual(NativeTokenDecimals.isSet, true);
    assert.strictEqual(NativeTokenDecimals["externalDecimals"], 8);
  });

  it("Deposit converts sent token amount with 8 decimals to 18 decimal places", async () => {
    const depositTx = await NativeTokenTransferGatewayInstance.write.depositToEVMWithMessage([
      destinationDomainID,
      zeroAddress,
      executionGasAmount,
      message
    ],
      {
        fromaccount: depositor.account,
        value: depositAmount
      }
    );

    await expect(depositTx).to.emit(BridgeInstance, "Deposit").withArgs(
      destinationDomainID,
      resourceID.toLowerCase(),
      expectedDepositNonce,
      depositor,
      depositProposalData,
      expectedHandlerResponse
    );
  });

  it("Proposal execution converts sent token amount with 18 decimals to 8 decimal places", async () => {
    const expectedRecipientTransferAmount = parseUnits("0.9", originDecimalPlaces);
    const proposalData = createOptionalContractCallDepositData(
      convertedTransferAmount, // 18 decimals
      zeroAddress,
      executionGasAmount,
      message
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
      proposalSignedData
    ],
      {
        account: relayer1.account,
        gas: executionGasAmount
      }
    );

    await expect(proposalTx).to.emit(NativeTokenHandlerInstance, "FundsTransferred").withArgs(
      expectedRecipientTransferAmount
    );

    const expectedHandlerResponse = encodeAbiParameters(
      parseAbiParameters(
        ["address", "address", "uint256"]
      ),
      [
        zeroAddress,
        DefaultMessageReceiverInstance.address,
        convertedTransferAmount,
      ]
    );

    await expect(proposalTx).to.emit(BridgeInstance, "ProposalExecution").withArgs(
      originDomainID,
      expectedDepositNonce,
      dataHash,
      expectedHandlerResponse
    );

    // check that deposit nonce has been marked as used in bitmap
    assert.isTrue(
      await BridgeInstance.read.isProposalExecuted([
        originDomainID,
        expectedDepositNonce
      ])
    );

    // check that tokens are transferred to recipient address
    const recipientBalanceAfter = await getBalance(evmRecipient);
    assert.strictEqual(transferredAmount.add(recipientBalanceBefore).toString(), recipientBalanceAfter);
  });
});
