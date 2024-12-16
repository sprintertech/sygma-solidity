// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {concat, encodeAbiParameters, fromBytes, Hex, keccak256, parseAbiParameters, toBytes, toFunctionSelector, WalletClient, zeroHash} from "viem";
import {mpcAddress,createResourceID, deploySourceChainContracts, createGmpDepositData, trimPrefix, constructGenericHandlerSetResourceData, blankFunctionDepositorOffset, blankFunctionSig, signTypedProposal, createGmpExecutionData} from "../../helpers";
import {ContractTypesMap} from 'hardhat/types';
import {loadFixture} from '@nomicfoundation/hardhat-network-helpers';
import {assert, expect} from 'chai';
import {Proposal} from '../../../types';

describe("GmpHandler - [Execute Proposal]", () => {
    const originDomainID = 1;
    const expectedDepositNonce = BigInt(1);

    const feeData = "0x";
    const destinationMaxFee = BigInt(900000);
    const hashOfTestStore = keccak256("0xc0ffee");
    const handlerResponseLength = BigInt(64);
    const contractCallReturnData = zeroHash;


    let BridgeInstance: ContractTypesMap["Bridge"];
    let TestStoreInstance: ContractTypesMap["TestStore"];
    let TestDepositInstance: ContractTypesMap["TestDeposit"];;
    let GmpHandlerInstance: ContractTypesMap["GmpHandler"];

    let depositor: WalletClient;
    let relayer1: WalletClient;
    let relayer2Address: WalletClient;
    let invalidExecutionContractAddress: WalletClient;

    let resourceID: Hex;
    let depositFunctionSignature: Hex;
    let depositData: Hex;
    let proposal: Proposal;

    before(async () => {
      ({
        BridgeInstance,
        TestStoreInstance,
        TestDepositInstance,
      } = await loadFixture(deploySourceChainContracts));
      [
        ,
        depositor,
        relayer1,
        relayer2Address,
        invalidExecutionContractAddress
      ] = await hre.viem.getWalletClients();

      resourceID = createResourceID(
        TestStoreInstance.address,
        originDomainID
      );

      depositFunctionSignature = toFunctionSelector(
        TestStoreInstance.write.storeWithDepositor.toString()
      );

      const GmpHandlerSetResourceData =
        constructGenericHandlerSetResourceData(
          depositFunctionSignature,
          blankFunctionDepositorOffset,
          blankFunctionSig
        );
      await BridgeInstance.write.adminSetResource([
        GmpHandlerInstance.address,
        resourceID,
        TestStoreInstance.address,
        GmpHandlerSetResourceData
      ]);

      depositData = createGmpDepositData(
        depositFunctionSignature,
        TestStoreInstance.address,
        destinationMaxFee,
        depositor.account!.address,
        hashOfTestStore
      );

      proposal = {
        originDomainID: originDomainID,
        depositNonce: expectedDepositNonce,
        data: depositData,
        resourceID: resourceID,
      };

      // set MPC address to unpause the Bridge
      await BridgeInstance.write.endKeygen([mpcAddress]);
    });

    it("deposit can be executed successfully", async () => {
      const proposalSignedData = await signTypedProposal(
        BridgeInstance.address,
        [proposal]
      );
      await expect(
        BridgeInstance.write.deposit([
          originDomainID,
          resourceID,
          depositData,
          feeData
        ],
          {
            account: depositor.account
          }
        )
      ).not.to.be.reverted;

      // relayer1 executes the proposal
      await expect(
        BridgeInstance.write.executeProposal([proposal, proposalSignedData], {
          account: relayer1.account,
        })
      ).not.to.be.reverted;

      // Verifying asset was marked as stored in TestStoreInstance
      assert.isTrue(
        await TestStoreInstance.read._assetsStored([hashOfTestStore])
      );
    });

    it("AssetStored event should be emitted", async () => {
      const proposalSignedData = await signTypedProposal(
        BridgeInstance.address,
        [proposal]
      );

      await expect(
        BridgeInstance.write.deposit([
          originDomainID,
          resourceID,
          depositData,
          feeData
        ],
          {
            account: depositor.account
          }
        )
      ).not.to.be.reverted;

      // relayer1 executes the proposal
      const executeTx = await BridgeInstance.write.executeProposal([
        proposal,
        proposalSignedData
      ],
        {
          account: relayer2Address.account
        }
      );

      await expect(executeTx).to.emit(TestStoreInstance, "AssetStored").withArgs(
        hashOfTestStore
      );

      assert.isTrue(
        await TestStoreInstance.read._assetsStored([hashOfTestStore]),
        "TestStore asset was not successfully stored"
      );
    });

    it("ProposalExecution should be emitted even if handler execution fails", async () => {
      const proposalSignedData = await signTypedProposal(
        BridgeInstance.address,
        [proposal]
      );
      // execution contract address
      const invalidDepositData = createGmpDepositData(
        depositFunctionSignature,
        invalidExecutionContractAddress.account!.address,
        destinationMaxFee,
        depositor.account!.address,
        hashOfTestStore
      );

      const depositDataHash = keccak256(
        concat([
          GmpHandlerInstance.address,
          trimPrefix(depositData)
        ])
      );

      await expect(
        BridgeInstance.write.deposit([
          originDomainID,
          resourceID,
          invalidDepositData,
          feeData
        ],
          {
            account: depositor.account
          }
        )
      ).not.to.be.reverted;

      // relayer1 executes the proposal
      const executeTx = await BridgeInstance.write.executeProposal([
        proposal,
        proposalSignedData
      ],
        {
          account: relayer1.account
        }
      );

      await expect(executeTx).to.emit(BridgeInstance, "ProposalExecution").withArgs(
        originDomainID,
        expectedDepositNonce,
        depositDataHash,
        encodeAbiParameters(
          parseAbiParameters(["bool", "uint256", "bytes32"]),
          [true, handlerResponseLength, contractCallReturnData]
        )
      );

      // check that deposit nonce isn't unmarked as used in bitmap
      assert.isTrue(
        await BridgeInstance.read.isProposalExecuted([
          originDomainID,
          expectedDepositNonce
        ])
      );

      // Check that asset isn't marked as stored in TestStoreInstance
      assert.isTrue(
        await TestStoreInstance.read._assetsStored([hashOfTestStore])
      );
    });

    it("ProposalExecution should be emitted even if gas specified too small", async () => {
      const num = BigInt(6);
      const addresses = [BridgeInstance.address, TestStoreInstance.address];
      const message = fromBytes(toBytes("message"), "hex");
      const executionData = encodeAbiParameters(
        parseAbiParameters(["uint", "address[]", "bytes"]),
        [num, addresses, message]
      );

      // If the target function accepts (address depositor, bytes executionData)
      // then this helper can be used
      const preparedExecutionData = await TestDepositInstance.read.prepareDepositData([executionData]);
      const depositFunctionSignature = toFunctionSelector(
        TestDepositInstance.write.executePacked.toString()
      );
      const tooSmallGas = BigInt(500);
      const depositData = createGmpDepositData(
        depositFunctionSignature,
        TestDepositInstance.address,
        tooSmallGas,
        depositor.account!.address,
        preparedExecutionData
      );
      const proposal = {
        originDomainID: originDomainID,
        depositNonce: expectedDepositNonce,
        data: depositData,
        resourceID: resourceID,
      };
      const proposalSignedData = await signTypedProposal(
        BridgeInstance.address,
        [proposal]
      );

      // relayer1 executes the proposal
      const executeTx = await BridgeInstance.write.executeProposal([
        proposal,
        proposalSignedData
      ],
        {
          account: relayer1.account
        }
      );

      // check that ProposalExecution event is emitted
      await expect (executeTx).to.emit(BridgeInstance, "ProposalExecution").withArgs(
        originDomainID,
        expectedDepositNonce
      );

      // check that deposit nonce isn't unmarked as used in bitmap
      assert.isTrue(
        await BridgeInstance.read.isProposalExecuted([
          originDomainID,
          expectedDepositNonce
        ])
      );

      await expect(executeTx).to.emit(TestDepositInstance, "TestExecute").withArgs(
        depositor,
        num,
        TestStoreInstance.address,
        message
      );
    });

    it("call with packed depositData should be successful", async () => {
      const num = BigInt(5);
      const addresses = [BridgeInstance.address, TestStoreInstance.address];
      const message = fromBytes(toBytes("message"), "hex");
      const executionData = encodeAbiParameters(
        parseAbiParameters(["uint", "address[]", "bytes"]),
        [num, addresses, message]
      );

      // If the target function accepts (address depositor, bytes executionData)
      // then this helper can be used
      const preparedExecutionData = await TestDepositInstance.read.prepareDepositData([executionData]);
      const depositFunctionSignature = toFunctionSelector(
        TestDepositInstance.write.executePacked.toString()
      );
      const depositData = createGmpDepositData(
        depositFunctionSignature,
        TestDepositInstance.address,
        destinationMaxFee,
        depositor.account!.address,
        preparedExecutionData
      );

      const proposal = {
        originDomainID: originDomainID,
        depositNonce: expectedDepositNonce,
        data: depositData,
        resourceID: resourceID,
      };
      const proposalSignedData = await signTypedProposal(
        BridgeInstance.address,
        [proposal]
      );
      await expect(
        BridgeInstance.write.deposit([
          originDomainID,
          resourceID,
          depositData,
          feeData
        ],
          {
            account: depositor.account
          }
        )
      ).not.to.be.reverted;

      // relayer1 executes the proposal
      const executeTx = await BridgeInstance.write.executeProposal([proposal, proposalSignedData], {
        account: relayer1.account,
      });


      await expect(executeTx).to.emit(BridgeInstance, "ProposalExecution").withArgs(
        originDomainID,
        expectedDepositNonce
      );

      await expect(executeTx).to.emit(TestStoreInstance, "TestExecute").withArgs(
        depositor,
        num,
        TestStoreInstance.address,
        message
      );
    });

    it("call with unpacked depositData should be successful", async () => {
      const num = 5;
      const addresses = [BridgeInstance.address, TestStoreInstance.address];
      const message = fromBytes(toBytes("message"), "hex");

      const executionData = createGmpExecutionData(
        ["uint", "address[]", "bytes"], [num, addresses, message]
      );

      const depositFunctionSignature = toFunctionSelector(
        TestDepositInstance.write.executeUnpacked.toString()
      );
      const depositData = createGmpDepositData(
        depositFunctionSignature,
        TestDepositInstance.address,
        destinationMaxFee,
        depositor.account!.address,
        executionData
      );

      const proposal = {
        originDomainID: originDomainID,
        depositNonce: expectedDepositNonce,
        data: depositData,
        resourceID: resourceID,
      };
      const proposalSignedData = await signTypedProposal(
        BridgeInstance.address,
        [proposal]
      );
      await expect(
        BridgeInstance.write.deposit([
          originDomainID,
          resourceID,
          depositData,
          feeData
        ],
          {
            account: depositor.account
          }
        )
      ).not.to.be.reverted;

      // relayer1 executes the proposal
      const executeTx = await BridgeInstance.write.executeProposal([proposal, proposalSignedData], {
        account: relayer1.account,
      });

      await expect(executeTx).to.emit(BridgeInstance, "ProposalExecution").withArgs(
        originDomainID,
        expectedDepositNonce
      );

      await expect(executeTx).to.emit(TestStoreInstance, "TestExecute").withArgs(
        depositor,
        num,
        TestStoreInstance.address,
        message
      );
    });
  }
);
