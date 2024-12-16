// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {createERCDepositData, createResourceID, deploySourceChainContracts, mpcAddress} from "../../helpers";
import {ContractTypesMap} from "hardhat/types";
import {Hex, toHex, WalletClient} from 'viem';
import {assert} from 'chai';




describe("ERC20Handler - [decimals]", () => {
  const originDomainID = 1;
  const destinationDomainID = 2;

  const tokenAmount = BigInt(100);
  const depositAmount = BigInt(10);
  const expectedDepositNonce = 1;
  const decimalPlaces = 11;
  const hexDecimalPlaces = toHex(decimalPlaces);

  const emptySetResourceData = "0x";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC20MintableInstance: ContractTypesMap["ERC20PresetMinterPauser"];
  let ERC20HandlerInstance: ContractTypesMap["ERC20Handler"];

  let depositor: WalletClient;
  let recipient: WalletClient;

  let resourceID: Hex;
  let depositProposalData: Hex;
  let proposal: Proposal;

  before(async () => {
    ({
      BridgeInstance,
      ERC20HandlerInstance,
      ERC20MintableInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      ,
      depositor,
      recipient,
    ] = await hre.viem.getWalletClients();

      resourceID = createResourceID(ERC20MintableInstance.address, originDomainID);

      proposal = {
        originDomainID: destinationDomainID,
        depositNonce: expectedDepositNonce,
        resourceID: resourceID,
        data: depositProposalData
      };

      depositProposalData = createERCDepositData(depositAmount, 20, recipient.account!.address)

      await ERC20MintableInstance.write.mint([depositor.account!.address, tokenAmount])
      await ERC20MintableInstance.write.approve([ERC20HandlerInstance.address, tokenAmount], {account: depositor.account}),
      await BridgeInstance.write.adminSetResource([
        ERC20HandlerInstance.address,
        resourceID,
        ERC20MintableInstance.address,
        // set decimal places for handler and token
        emptySetResourceData
      ]);

      // set MPC address to unpause the Bridge
      await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("[sanity] decimals value is not set if 'adminSetResource' is called with empty args", async () => {
      const ERC20MintableInstanceDecimals = (await ERC20HandlerInstance.read._tokenContractAddressToTokenProperties([
        ERC20MintableInstance.address
      ]))[3];

      assert.strictEqual(ERC20MintableInstanceDecimals.isSet, false)
      assert.strictEqual(ERC20MintableInstanceDecimals["externalDecimals"], 0)
  });

  it("[sanity] decimals value is set if args are provided to 'adminSetResource'", async () => {
      await BridgeInstance.write.adminSetResource([
        ERC20HandlerInstance.address,
        resourceID,
        ERC20MintableInstance.address,
        // set decimal places for handler and token
        hexDecimalPlaces
      ]);

      const ERC20MintableInstanceDecimals = (await ERC20HandlerInstance.read._tokenContractAddressToTokenProperties([
        ERC20MintableInstance.address
      ]))[3];

      assert.strictEqual(ERC20MintableInstanceDecimals.isSet, true);
      assert.strictEqual(ERC20MintableInstanceDecimals["externalDecimals"], 11);
      assert.strictEqual(
        ERC20MintableInstanceDecimals["externalDecimals"],
        (await ERC20MintableInstance.read.decimals())
      );
  });
});
