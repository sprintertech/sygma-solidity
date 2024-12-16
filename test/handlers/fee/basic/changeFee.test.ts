// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {ContractTypesMap} from "hardhat/types";
import {Hex, parseEther, WalletClient} from "viem";
import {deploySourceChainContracts} from "../../../helpers";
import {assert, expect} from "chai";

const Helpers = require("../../../helpers");

describe("BasicFeeHandler - [changeFee]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;
  const fee = parseEther("0.05");

  let BridgeInstance: ContractTypesMap["Bridge"];
  let BasicFeeHandlerInstance: ContractTypesMap["BasicFeeHandler"];

  let nonAdmin: WalletClient;

  let resourceID: Hex;


  before(async () => {
    ({
      BridgeInstance,
      BasicFeeHandlerInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      nonAdmin,
    ] = await hre.viem.getWalletClients();
  });

  it("should set fee", async () => {
    const changeFeeTx = await BasicFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee]);

    await expect(changeFeeTx).to.emit(BasicFeeHandlerInstance, "FeeChanged").withArgs(
      parseEther("0.05")
    );

    const newFee = await BasicFeeHandlerInstance.read._domainResourceIDToFee([destinationDomainID, resourceID]);
    assert.equal(newFee, parseEther("0.05"));
  });

  it("should not set the same fee", async () => {
    await expect(
      BasicFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, fee])).to.be.revertedWith(
      "Current fee is equal to new fee"
    );
  });

  it("should require admin role to change fee", async () => {
    await expect(BasicFeeHandlerInstance.write.changeFee([
      destinationDomainID, resourceID, BigInt(1)
    ],
      {
        account: nonAdmin.account!.address
      }
    ));
  });
});
