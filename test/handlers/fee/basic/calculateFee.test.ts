// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {ContractTypesMap} from "hardhat/types";
import {Hex, parseEther, WalletClient} from "viem";
import {deploySourceChainContracts} from "../../../helpers";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {assert} from 'chai';

const Helpers = require("../../../helpers");

describe("BasicFeeHandler - [calculateFee]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;
  const feeData = "0x";
  const emptySetResourceData = "0x";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let BasicFeeHandlerInstance: ContractTypesMap["BasicFeeHandler"];
  let DefaultMessageReceiverInstance: ContractTypesMap["DefaultMessageReceiver"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];
  let FeeHandlerRouterInstance: ContractTypesMap["FeeHandlerRouter"];
  let ERC20HandlerInstance: ContractTypesMap["ERC20Handler"];

  let recipient: WalletClient;
  let relayer1: WalletClient;

  let resourceID: Hex;
  let depositData: Hex;

  before(async () => {
    ({
      BridgeInstance,
      BasicFeeHandlerInstance,
      ERC20MintableInstance,
      ERC20HandlerInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      recipient,
      relayer1,
    ] = await hre.viem.getWalletClients();

    resourceID = createResourceID(
      ERC20MintableInstance.address,
      originDomainID
    );

    depositData = createERCDepositData(100, 20, recipient.account!.address);

    await BridgeInstance.write.adminSetResource([
      ERC20HandlerInstance.address,
      resourceID,
      ERC20MintableInstance.address,
      emptySetResourceData
    ]);
    await BridgeInstance.write.adminChangeFeeHandler([FeeHandlerRouterInstance.address]);
    await FeeHandlerRouterInstance.write.adminSetResourceHandler([
      destinationDomainID,
      resourceID,
      BasicFeeHandlerInstance.address
    ]);
  });

  it("should return amount of fee", async () => {
    // current fee is set to 0
    let res = await FeeHandlerRouterInstance.read.calculateFee([
      relayer1.account!.address,
      originDomainID,
      destinationDomainID,
      resourceID,
      depositData,
      feeData
    ]);

    assert.equal(web3.utils.fromWei(res[0], "ether"), "0");
    // Change fee to 0.5 ether
    await BasicFeeHandlerInstance.write.changeFee([destinationDomainID, resourceID, parseEther("0.5")]);
    res = await FeeHandlerRouterInstance.read.calculateFee([
      relayer1.account!.address,
      originDomainID,
      destinationDomainID,
      resourceID,
      depositData,
      feeData
    ]);
    assert.equal(web3.utils.fromWei(res[0], "ether"), "0.5");
  });
});
