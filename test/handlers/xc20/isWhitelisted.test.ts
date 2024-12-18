// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {ContractTypesMap} from "hardhat/types";
import {createResourceID, deploySourceChainContracts} from "../../helpers";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {Hex} from "viem";
import {assert} from "chai";


describe("XC20Handler - [isWhitelisted]", async () => {
  const emptySetResourceData = "0x";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC20MintableInstance1: ContractTypesMap["ERC20PresetMinterPauser"];
  let ERC20MintableInstance2: ContractTypesMap["ERC20PresetMinterPauser"];
  let XC20HandlerInstance: ContractTypesMap["XC20Handler"];

  let resourceID: Hex;

  beforeEach(async () => {
    ({
      BridgeInstance,
      ERC20MintableInstance: ERC20MintableInstance1,
      ERC20MintableInstance: ERC20MintableInstance2,
      XC20HandlerInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      depositor,
      recipient
    ] = await hre.viem.getWalletClients();

    resourceID = createResourceID(
      ERC20MintableInstance1.address,
      domainID
    );
  });

  it("initialContractAddress should be whitelisted", async () => {
    await BridgeInstance.write.adminSetResource([
      XC20HandlerInstance.address,
      resourceID,
      ERC20MintableInstance1.address,
      emptySetResourceData
    ]);
    const isWhitelisted = (await XC20HandlerInstance.read._tokenContractAddressToTokenProperties([
      ERC20MintableInstance1.address
    ]))[0];

    assert.isTrue(isWhitelisted, "Contract wasn't successfully whitelisted");
  });
});
