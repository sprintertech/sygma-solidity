// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {ContractTypesMap} from "hardhat/types";
import {formatUnits, Hex, parseEther, parseUnits, WalletClient} from "viem";
import {deploySourceChainContracts} from "../../../helpers";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {assert, expect} from 'chai';

const Helpers = require("../../../helpers");

describe("PercentageFeeHandler - [change fee and bounds]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;
  const fee = BigInt(25);
  const lowerBound = BigInt(50);
  const upperBound = BigInt(100);

  let resourceID: Hex;

  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];
  let PercentageFeeHandlerInstance: ContractTypesMap["PercentageERC20FeeHandler"];

  let admin: WalletClient;
  let nonAdmin: WalletClient;

  before(async () => {
    ({
      BridgeInstance,
      PercentageFeeHandlerInstance,
      ERC20MintableInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      admin,
      nonAdmin,
    ] = await hre.viem.getWalletClients();


    resourceID = createResourceID(
      ERC20MintableInstance.address,
      originDomainID
    );
  });

  it("should set fee", async () => {
    const changeFeeTx = await PercentageFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);

    await expect(changeFeeTx).to.emit(PercentageFeeHandlerInstance, "FeeChanged").withArgs(
      BigInt(25)
    );
    const newFee = await PercentageFeeHandlerInstance.read._domainResourceIDToFee([destinationDomainID, resourceID]);
    assert.equal(BigInt(newFee), fee);
  });

  it("should not set the same fee", async () => {
    await expect(
      PercentageFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee])
    ).to.be.revertedWithCustomError(PercentageFeeHandlerInstance, "Current fee is equal to new fee");
  });

  it("should require admin role to change fee", async () => {
    await expect(
      PercentageFeeHandlerInstance.write.changeFee([
        destinationDomainID,
        resourceID,
        fee
      ],
        {
          account: nonAdmin.account!.address
        }
      )
    ).to.be.revertedWith("sender doesn't have admin role");
  });

  it("should set fee bounds", async () => {
    const changeFeeBoundsTx = await PercentageFeeHandlerInstance.write.changeFeeBounds([resourceID, lowerBound, upperBound]);

    await expect(changeFeeBoundsTx).to.emit(PercentageFeeHandlerInstance, "FeeBoundsChanged").withArgs(
      lowerBound,
      upperBound
    );

    const newLowerBound = (await PercentageFeeHandlerInstance.read._resourceIDToFeeBounds([resourceID]))[0];
    const newUpperBound = (await PercentageFeeHandlerInstance.read._resourceIDToFeeBounds([resourceID]))[1];
    assert.equal(newLowerBound, BigInt(50));
    assert.equal(newUpperBound, BigInt(100));
  });

  it("should not set the same fee bounds", async () => {
    await expect(
      PercentageFeeHandlerInstance.write.changeFeeBounds([resourceID, lowerBound, upperBound])
    ).to.be.revertedWith("Current bounds are equal to new bounds");
  });

  it("should fail to set lower bound larger than upper bound ", async () => {
    await expect(
      PercentageFeeHandlerInstance.write.changeFeeBounds([resourceID, BigInt(60), BigInt(25)])
    ).to.be.revertedWith("Upper bound must be larger than lower bound or 0");
  });

  it("should set only lower bound", async () => {
    const newLowerBound = BigInt(60);

    await PercentageFeeHandlerInstance.write.changeFeeBounds([resourceID, newLowerBound, upperBound]);
    const currentLowerBound = (await PercentageFeeHandlerInstance.read._resourceIDToFeeBounds([resourceID]))[0];
    assert.equal(currentLowerBound, newLowerBound);
  });

  it("should set only upper bound", async () => {
    const newUpperBound = BigInt(120);

    await PercentageFeeHandlerInstance.write.changeFeeBounds([resourceID, BigInt(60), newUpperBound]);
    const currentUpperBound = (await PercentageFeeHandlerInstance.read._resourceIDToFeeBounds([resourceID]))[1];
    assert.equal(newUpperBound, currentUpperBound);
  });

  it("should require admin role to change fee bunds", async () => {
    const newLowerBound = BigInt(80);
    const newUpperBound = BigInt(200);
    await expect(PercentageFeeHandlerInstance.write.changeFeeBounds([
      resourceID,
      newLowerBound,
      newUpperBound
    ],
      {
        account: nonAdmin.account!.address
      }
    ));
  });
});
