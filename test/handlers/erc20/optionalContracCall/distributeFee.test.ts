// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {encodeFunctionData, Hex, keccak256, parseAbiParameters, parseUnits, toFunctionSelector, toHex, WalletClient, zeroAddress} from "viem";
import {createGmpDepositData, createMessageCallData, createOptionalContractCallDepositData, createResourceID, deploySourceChainContracts, mpcAddress} from "../../../helpers";
import {ContractTypesMap} from 'hardhat/types';
import {loadFixture} from '@nomicfoundation/hardhat-network-helpers';
import {assert, expect} from 'chai';
import {Proposal} from '../../../../types';

describe("PercentageFeeHandler - [distributeFee]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;

  const expectedDepositNonce = BigInt(1);
  const depositAmount = BigInt(100000);
  const feeData = "0x";
  const emptySetResourceData = "0x";
  const feeAmount = BigInt(30);
  const feeBps = BigInt(30000); // 3 BPS
  const payout = BigInt(10);
  const transactionId = toHex(1, {size:32});
  const executionGasAmount = BigInt(30000000);

  let DefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"]
  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];
  let ERC20HandlerInstance: ContractTypesMap["ERC20Handler"];
  let ERC721MintableInstance: ContractTypesMap["ERC721MinterBurnerPauser"];
  let ERC20BasicFeeHandlerInstance: ContractTypesMap["BasicFeeHandler"];
  let ERC721BasicFeeHandlerInstance: ContractTypesMap["BasicFeeHandler"];
  let FeeHandlerRouterInstance: ContractTypesMap["FeeHandlerRouter"];
  let PercentageFeeHandlerInstance: ContractTypesMap["PercentageERC20FeeHandler"];

  let nonAdmin: WalletClient;
  let depositor: WalletClient;
  let recipient: WalletClient;
  let firstEOA: WalletClient;
  let secondEOA: WalletClient;

  let message: Hex;
  let depositProposalData: Hex;
  let proposal: Proposal;
  let resourceID: Hex;

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
      nonAdmin,
      depositor,
      recipient,
      firstEOA,
      secondEOA
    ] = await hre.viem.getWalletClients();

    resourceID = createResourceID(
      ERC20MintableInstance.address,
      originDomainID
    );

    await BridgeInstance.write.adminSetResource([
      ERC20HandlerInstance.address,
      resourceID,
      ERC20MintableInstance.address,
      emptySetResourceData
    ]);
    await ERC20MintableInstance.write.mint([depositor.account!.address, depositAmount + feeAmount]),
    await ERC20MintableInstance.write.approve([ERC20HandlerInstance.address, depositAmount], {
      account: depositor.account,
    });
    await ERC20MintableInstance.write.approve([
      PercentageFeeHandlerInstance.address,
      depositAmount
    ],
      {account: depositor.account}
    ),
    await BridgeInstance.write.adminChangeFeeHandler([FeeHandlerRouterInstance.address]);
    await FeeHandlerRouterInstance.write.adminSetResourceHandler([
      destinationDomainID,
      resourceID,
      PercentageFeeHandlerInstance.address
    ]);
    await PercentageFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, feeBps]);

    await DefaultMessageReceiverInstance.write.grantRole([
      await DefaultMessageReceiverInstance.read.SYGMA_HANDLER_ROLE(),
      ERC20HandlerInstance.address
    ]);

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

  it("should distribute fees", async () => {
    // check the balance is 0
    const firstEOABalanceBefore = (
      await ERC20MintableInstance.read.balanceOf([firstEOA.account!.address])
    );
    const secondEOABalanceBefore = (
      await ERC20MintableInstance.read.balanceOf([secondEOA.account!.address])
    );

    await expect(
      BridgeInstance.write.deposit([
        destinationDomainID,
        resourceID,
        depositProposalData,
        feeData],
        {
          account: depositor.account,
        }
      )
    ).not.to.be.reverted;
    const percentageFeeHandlerBalance = await ERC20MintableInstance.read.balanceOf([
      PercentageFeeHandlerInstance.address
    ]);
    assert.equal(percentageFeeHandlerBalance, feeAmount);

    // Transfer the funds
    const transferFeeTx = await PercentageFeeHandlerInstance.write.transferERC20Fee([
      resourceID,
      [firstEOA.account!.address, secondEOA.account!.address],
      [payout, payout]
    ]);

    await expect(transferFeeTx).to.emit(PercentageFeeHandlerInstance, "FeeDistributed").withArgs(
      ERC20MintableInstance.address,
      firstEOA.account!.address,
      payout
    );
    await expect(transferFeeTx).to.emit(PercentageFeeHandlerInstance, "FeeDistributed").withArgs(
      ERC20MintableInstance.address,
      secondEOA.account!.address,
      payout
    );

    const firstEOABalanceAfter = await ERC20MintableInstance.read.balanceOf([firstEOA.account!.address]);
    const secondEOABalanceAfter = await ERC20MintableInstance.read.balanceOf([secondEOA.account!.address]);
    assert.equal(firstEOABalanceAfter, firstEOABalanceBefore +  payout);
    assert.equal(secondEOABalanceAfter, secondEOABalanceBefore +  payout);
  });

  it("should not distribute fees with other resourceID", async () => {
    await expect(
      BridgeInstance.write.deposit([
        destinationDomainID,
        resourceID,
        depositProposalData,
        feeData
      ],
        {
          account: depositor.account,
        }
      )
    );
    const percentageFeeHandlerBalance = await ERC20MintableInstance.read.balanceOf([
      PercentageFeeHandlerInstance.address
    ]);
    assert.equal(percentageFeeHandlerBalance, feeAmount);

    const incorrectResourceID = createResourceID(
      PercentageFeeHandlerInstance.address,
      originDomainID
    );

    // Transfer the funds: fails
    await expect(
      PercentageFeeHandlerInstance.write.transferERC20Fee([
        incorrectResourceID,
        [firstEOA.account!.address, secondEOA.account!.address],
        [payout, payout]
      ])
    ).to.be.reverted;
  });

  it("should require admin role to distribute fee", async () => {
    await expect(
      BridgeInstance.write.deposit([
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

    const percentageFeeHandlerBalance = await ERC20MintableInstance.read.balanceOf([
      PercentageFeeHandlerInstance.address
    ]);
    assert.equal(percentageFeeHandlerBalance, feeAmount);

    await expect(
      PercentageFeeHandlerInstance.write.transferERC20Fee([
      resourceID,
      [firstEOA.account!.address, secondEOA.account!.address],
      [payout, payout]
    ],{
      account: nonAdmin.account
    }
  )).to.be.revertedWith("sender doesn't have admin role");
  });

  it("should revert if addrs and amounts arrays have different length", async () => {
    await expect(
      BridgeInstance.write.deposit([
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

    const percentageFeeHandlerBalance = await ERC20MintableInstance.read.balanceOf([
      PercentageFeeHandlerInstance.address
    ]);
    assert.equal(percentageFeeHandlerBalance, feeAmount);

    await expect(
      PercentageFeeHandlerInstance.write.transferERC20Fee([
        resourceID,
        [firstEOA.account!.address, secondEOA.account!.address],
        [payout, payout, payout]
      ]),
    ).to.be.revertedWith("addrs[], amounts[]: diff length");
  });
});
