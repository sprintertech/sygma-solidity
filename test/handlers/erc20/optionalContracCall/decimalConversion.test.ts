// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {concat, encodeAbiParameters, encodeFunctionData, Hex, keccak256, parseAbiParameters, parseUnits, toFunctionSelector, toHex, WalletClient, zeroAddress} from "viem";
import {createGmpDepositData, createMessageCallData, createOptionalContractCallDepositData, createOptionalContractCallDepositData, createResourceID, deploySourceChainContracts, mpcAddress, signTypedProposal, trimPrefix} from "../../../helpers";
import {ContractTypesMap} from 'hardhat/types';
import {loadFixture} from '@nomicfoundation/hardhat-network-helpers';
import {assert, expect} from 'chai';
import {Wallet} from 'ethers';
import {Proposal} from '../../../../types';


describe("Bridge - [decimal conversion - erc20 token]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;
  const returnBytesLength = 128;

  const expectedDepositNonce = BigInt(1);
  const resourceID = toHex(650, {size:32});
  const originDecimalPlaces = 8;
  const bridgeDefaultDecimalPlaces = 18;
  const initialTokenAmount = parseUnits("100", originDecimalPlaces);
  const depositAmount = parseUnits("10", originDecimalPlaces);
  const fee = BigInt(100000); // BPS
  const feeAmount = parseUnits("1", originDecimalPlaces);
  const convertedTransferAmount = parseUnits("10", bridgeDefaultDecimalPlaces);
  const transactionId = toHex(1, {size:32});
  const executionGasAmount = BigInt(30000000);
  const amountToMint = BigInt(1);
  const feeData = "0x";

  const expectedHandlerResponse =
  encodeAbiParameters(
    parseAbiParameters(
      ["uint256"]
    ),
      [convertedTransferAmount]
  );

  let DefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"]
  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];
  let ERC20HandlerInstance: ContractTypesMap["ERC20Handler"];
  let ERC721MintableInstance: ContractTypesMap["ERC721MinterBurnerPauser"];
  let ERC20BasicFeeHandlerInstance: ContractTypesMap["BasicFeeHandler"];
  let ERC721BasicFeeHandlerInstance: ContractTypesMap["BasicFeeHandler"];
  let FeeHandlerRouterInstance: ContractTypesMap["FeeHandlerRouter"];
  let PercentageFeeHandlerInstance: ContractTypesMap["PercentageERC20FeeHandler"];

  let depositor: WalletClient;
  let evmRecipient: WalletClient;
  let relayer1: WalletClient;

  let depositProposalData: Hex;
  let message: Hex;
  let proposal: Proposal;

  beforeEach(async () => {
    ({
      DefaultMessageReceiverInstance,
      BridgeInstance,
      ERC20MintableInstance,
      ERC20HandlerInstance,
      ERC721MintableInstance,
      BasicFeeHandlerInstance: ERC20BasicFeeHandlerInstance,
      BasicFeeHandlerInstance: ERC721BasicFeeHandlerInstance,
      PercentageFeeHandlerInstance
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      depositor,
      evmRecipient
    ] = await hre.viem.getWalletClients();

    await ERC20MintableInstance.write.mint([depositor.account!.address, initialTokenAmount]);
    await ERC20MintableInstance.write.mint([ERC20HandlerInstance.address, initialTokenAmount]);

    await BridgeInstance.write.adminSetResource([
        ERC20HandlerInstance.address,
        resourceID,
        ERC20MintableInstance.address,
        toHex(originDecimalPlaces)
      ]);
    await BridgeInstance.write.adminSetBurnable([
      ERC20HandlerInstance.address,
      ERC20MintableInstance.address
    ]);
    await PercentageFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);
    await BridgeInstance.write.adminChangeFeeHandler([FeeHandlerRouterInstance.address]);
    await FeeHandlerRouterInstance.write.adminSetResourceHandler([
      destinationDomainID,
      resourceID,
      PercentageFeeHandlerInstance.address
    ]);

    await DefaultMessageReceiverInstance.write.grantRole([
      await DefaultMessageReceiverInstance.read.SYGMA_HANDLER_ROLE(),
      ERC20HandlerInstance.address
    ]);

    await ERC721MintableInstance.write.grantRole([
      await ERC721MintableInstance.read.MINTER_ROLE(),
      DefaultMessageReceiverInstance.address
    ]);

    await ERC20MintableInstance.write.grantRole([
      await ERC20MintableInstance.read.MINTER_ROLE(),
      DefaultMessageReceiverInstance.address
    ]);

    await ERC20MintableInstance.write.grantRole([
      await ERC20MintableInstance.read.MINTER_ROLE(),
      ERC20HandlerInstance.address
    ]);

    await ERC20MintableInstance.write.approve([
      PercentageFeeHandlerInstance.address,
      feeAmount
    ],
      {
        account: depositor.account
      }
    );
    await ERC20MintableInstance.write.approve([
      ERC20HandlerInstance.address,
      depositAmount
    ],
      {
        account: depositor.account
      }
    );

    const actionData = encodeFunctionData({
      abi: ["function mint(address to, uint256 tokenId, string memory _data)"],
      functionName: "mint",
      args: [evmRecipient, "5", ""]
    });

    const actions = [{
      nativeValue: BigInt(0),
      callTo: ERC721MintableInstance.address,
      approveTo: zeroAddress,
      tokenSend: zeroAddress,
      tokenReceive: zeroAddress,
      data: actionData,
    }];
    message = createMessageCallData(
      transactionId,
      actions,
      evmRecipient.account!.address
    );

    depositProposalData = createOptionalContractCallDepositData(
      depositAmount,
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

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });


  it("[sanity] decimals value is set if args are provided to 'adminSetResource'", async () => {
    const ERC20Decimals = (await ERC20HandlerInstance.read._tokenContractAddressToTokenProperties([
      ERC20MintableInstance.address
    ]))[3];

    assert.strictEqual(ERC20Decimals.isSet, true);
    assert.strictEqual(ERC20Decimals["externalDecimals"], 8);
  });

  it("Deposit converts sent token amount with 8 decimals to 18 decimal places", async () => {
    const depositTx = await BridgeInstance.write.deposit([
      destinationDomainID,
      resourceID,
      depositProposalData,
      feeData
    ],
      {
        account: depositor.account,
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
    const proposalData = createOptionalContractCallDepositData(
      convertedTransferAmount, // 18 decimals
      zeroAddress,
      executionGasAmount,
      message
    );

    const dataHash = keccak256(
      concat([
        ERC20HandlerInstance.address,
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

    const recipientBalanceBefore = await ERC721MintableInstance.read.balanceOf([evmRecipient.account!.address]);

    const proposalTx = await BridgeInstance.write.executeProposal([
      proposal,
      proposalSignedData
    ],
      {
        account: relayer1.account,
        gas: executionGasAmount
      }
    );

    const expectedHandlerResponse = encodeAbiParameters(
      parseAbiParameters(
        ["address", "address", "uint256", "uint16", "uint256"]
      ),
      [
        ERC20MintableInstance.address,
        DefaultMessageReceiverInstance.address,
        convertedTransferAmount,
        returnBytesLength,
        BigInt(0)
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

    // check that ERC721 token is transferred to recipient address
    const recipientBalanceAfter = await ERC721MintableInstance.read.balanceOf([evmRecipient.account!.address]);
    assert.strictEqual(recipientBalanceBefore + amountToMint,
      recipientBalanceAfter
    );
  });
});
