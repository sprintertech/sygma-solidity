// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {encodeAbiParameters, encodeFunctionData, Hex, keccak256, parseAbiParameters, parseUnits, toFunctionSelector, toHex, WalletClient, zeroAddress} from "viem";
import {createGmpDepositData, createMessageCallData, createOptionalContractCallDepositData, createResourceID, deploySourceChainContracts, mpcAddress} from "../../../helpers";
import {ContractTypesMap} from 'hardhat/types';
import {loadFixture} from '@nomicfoundation/hardhat-network-helpers';
import {assert, expect} from 'chai';
import {Wallet} from 'ethers';
import {Proposal} from '../../../../types';

describe("Bridge - [deposit - erc20 token with contract call]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;

  const expectedDepositNonce = BigInt(1);
  const emptySetResourceData = "0x";
  const resourceID = toHex(650, {size:32});
  const initialTokenAmount = BigInt(100);
  const depositAmount = BigInt(10);
  const fee = BigInt(1);
  const transactionId = toHex(1, {size:32});
  const executionGasAmount = BigInt(30000000);
  const feeData = "0x";

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
  let recipient: WalletClient;

  let message: Hex;
  let depositProposalData: Hex;
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
        recipient
      ] = await hre.viem.getWalletClients();

    await ERC20MintableInstance.write.mint([depositor.account!.address, initialTokenAmount]);

    await BridgeInstance.write.adminSetResource([
        ERC20HandlerInstance.address,
        resourceID,
        ERC20MintableInstance.address,
        emptySetResourceData
      ]);

    await ERC20MintableInstance.write.approve([
      ERC20HandlerInstance.address,
      depositAmount
    ],
      {
        account: depositor.account
      }
    );

    await PercentageFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);
    await BridgeInstance.write.adminChangeFeeHandler([FeeHandlerRouterInstance.address]);
    await FeeHandlerRouterInstance.write.adminSetResourceHandler([
      destinationDomainID,
      resourceID,
      PercentageFeeHandlerInstance.address
    ]);

    await ERC20MintableInstance.write.grantRole([
      await ERC20MintableInstance.read.MINTER_ROLE(),
      DefaultMessageReceiverInstance.address
    ]);

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
      args: [recipient, "5", ""]
    });

    const actions = [{
      nativeValue: BigInt(0),
      callTo: ERC721MintableInstance.address,
      approveTo: zeroAddress,
      tokenSend: zeroAddress,
      tokenReceive: zeroAddress,
      data: actionData,
    }]
    message = createMessageCallData(
      transactionId,
      actions,
      recipient.account!.address
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

  it("Native token deposit to EVM with message can be made", async () => {
    await expect(
      await BridgeInstance.write.deposit([
        destinationDomainID,
        resourceID,
        depositProposalData,
        feeData
      ],
        {
          account: depositor.account,
        }
      )
    ).not.to.be.reverted;
  });

  it("_depositCounts should be increments from 0 to 1", async () => {
    await BridgeInstance.write.deposit([
      destinationDomainID,
      resourceID,
      depositProposalData,
      feeData
    ],
      {
        account: depositor.account,
      }
    );

    const depositCount = await BridgeInstance.read._depositCounts([
      destinationDomainID
    ]);
    assert.strictEqual(depositCount, expectedDepositNonce);
  });

  it("Deposit event is fired with expected value", async () => {
    const depositTx = await BridgeInstance.write.deposit([
      destinationDomainID,
      resourceID,
      depositProposalData,
      feeData],
      {
        account: depositor.account,
      }
    );

    await expect(depositTx).to.emit(BridgeInstance, "Deposit").withArgs(
      destinationDomainID,
      resourceID.toLowerCase(),
      expectedDepositNonce,
      depositor,
      depositProposalData.toLowerCase(),
      null
    );
  });

  it("Should revert if destination domain is current bridge domain", async () => {
    await expect(
      BridgeInstance.write.deposit([
        originDomainID,
        resourceID,
        depositProposalData,
        feeData
      ],
        {
          account: depositor.account,
        }
      )
    ).to.be.reverted;
  });
});
