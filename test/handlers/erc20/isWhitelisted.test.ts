// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {ContractTypesMap} from "hardhat/types";
import {createResourceID, deploySourceChainContracts} from "../../helpers";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {assert, expect} from 'chai';
import {Hex} from 'viem';


describe("ERC20Handler - [isWhitelisted]", () => {
  const domainID = 1;
  const emptySetResourceData = "0x";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let DefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];
  let ERC20HandlerInstance: ContractTypesMap["ERC20Handler"];

  let resourceID: Hex;

  before(async () => {
    ({
      BridgeInstance,
      ERC20MintableInstance,
    } = await loadFixture(deploySourceChainContracts));

    resourceID = createResourceID(
      ERC20MintableInstance.address,
      domainID
    );
  });

  it("initialContractAddress should be whitelisted", async () => {
    await BridgeInstance.write.adminSetResource([
      ERC20HandlerInstance.address,
      resourceID,
      ERC20MintableInstance.address,
      emptySetResourceData
    ]);
    const isWhitelisted = (await ERC20HandlerInstance.read._tokenContractAddressToTokenProperties([
      ERC20MintableInstance.address
    ]))[0];

    assert.isTrue(isWhitelisted, "Contract wasn't successfully whitelisted");
  })
})
