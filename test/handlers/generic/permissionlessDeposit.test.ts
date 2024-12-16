// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {Hex, keccak256, toFunctionSelector, WalletClient} from "viem";
import {createGmpDepositData, createResourceID, deploySourceChainContracts, mpcAddress} from "../../helpers";
import {ContractTypesMap} from 'hardhat/types';
import {loadFixture} from '@nomicfoundation/hardhat-network-helpers';
import {expect} from 'chai';


describe("GmpHandler - [deposit]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;
  const expectedDepositNonce = 1;

  let depositor: WalletClient;
  let invaliddepositor: WalletClient;

  const feeData = "0x";
  const destinationMaxFee = BigInt(900000);
  const hashOfTestStore = keccak256("0xc0ffee");
  const emptySetResourceData = "0x";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let TestStoreInstance: ContractTypesMap["TestStore"];
  let GmpHandlerInstance:  ContractTypesMap["GmpHandler"];

  let resourceID: Hex;
  let depositFunctionSignature: Hex;
  let depositData: Hex;

  before(async () => {
    ({
      BridgeInstance,
      TestStoreInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      depositor,
      invaliddepositor,
    ] = await hre.viem.getWalletClients();

    resourceID = createResourceID(
      TestStoreInstance.address,
      originDomainID
    );

    await BridgeInstance.write.adminSetResource([
      GmpHandlerInstance.address,
      resourceID,
      TestStoreInstance.address,
      emptySetResourceData
    ]);

    depositFunctionSignature = toFunctionSelector(
      TestStoreInstance.write.storeWithDepositor.toString()
    );

    depositData = createGmpDepositData(
      depositFunctionSignature,
      TestStoreInstance.address,
      destinationMaxFee,
      depositor.account!.address,
      hashOfTestStore
    );

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("deposit can be made successfully", async () => {
    await expect(
      BridgeInstance.write.deposit([
        destinationDomainID,
        resourceID,
        depositData,
        feeData
      ],
        {

          account: depositor.account
        }
      )
    ).not.to.be.reverted;
  });

  it("depositEvent is emitted with expected values", async () => {
    const depositTx = await BridgeInstance.write.deposit([
      destinationDomainID,
      resourceID,
      depositData,
      feeData
    ],
      {
        account: depositor.account
      }
    );

    await expect(depositTx).to.emit(BridgeInstance, "Deposit").withArgs(
      destinationDomainID,
      resourceID.toLowerCase(),
      expectedDepositNonce,
      depositor,
      depositData,
      null
    );
  });

  it("deposit data should be of required length", async () => {
    // Min length is 76 bytes
    const invalidDepositData= "0x" + "aa".repeat(75) as unknown as Hex;

    await expect(
      BridgeInstance.write.deposit([
        destinationDomainID,
        resourceID,
        invalidDepositData,
        feeData
      ],
        {
          account: depositor.account
        }
      ),
    ).to.be.revertedWith("Incorrect data length");
  });

  it("should revert if metadata encoded depositor does not match deposit depositor", async () => {
    const invalidDepositData = createGmpDepositData(
      depositFunctionSignature,
      TestStoreInstance.address,
      destinationMaxFee,
      invaliddepositor.account!.address,
      hashOfTestStore
    );

    await expect(
      BridgeInstance.write.deposit([
        destinationDomainID,
        resourceID,
        invalidDepositData,
        feeData
      ],
        {
          account: depositor.account
        }
      ),
    ).to.be.revertedWith("incorrect depositor in deposit data");
  });


  it("should revert if max fee exceeds 1000000", async () => {
    const invalidMaxFee = BigInt(1000001);
    const invalidDepositData = createGmpDepositData(
      depositFunctionSignature,
      TestStoreInstance.address,
      invalidMaxFee ,
      depositor.account!.address,
      hashOfTestStore
    );

    await expect(
      BridgeInstance.write.deposit([
        destinationDomainID,
        resourceID,
        invalidDepositData,
        feeData
      ],
        {
          account: depositor.account
        }
      ),
    ).to.be.revertedWith("requested fee too large");
  });
});
