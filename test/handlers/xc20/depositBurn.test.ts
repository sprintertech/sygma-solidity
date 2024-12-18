// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {WalletClient} from "viem";
import {mpcAddress} from "../../helpers";
import {ContractTypesMap} from "hardhat/types";
import {createResourceID, deploySourceChainContracts} from "../../helpers";
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {Hex} from "viem";
import {assert} from "chai";

describe("XC20Handler - [Deposit Burn XC20]", () => {
  const domainID = 1;

  const initialTokenAmount = BigInt(100);
  const depositAmount = BigInt(10);
  const emptySetResourceData = "0x";

  let BridgeInstance: ContractTypesMap["Bridge"];
  let ERC20MintableInstance1: ContractTypesMap["ERC20PresetMinterPauser"];
  let ERC20MintableInstance2: ContractTypesMap["ERC20PresetMinterPauser"];
  let XC20HandlerInstance: ContractTypesMap["XC20Handler"];

  let admin: WalletClient;
  let depositor: WalletClient;
  let recipient: WalletClient;
  let EOA_Address: WalletClient;

  let resourceID1: Hex;
  let resourceID2: Hex;
  let depositData: Hex;
  let burnableContractAddresses: Array<Hex>;

  beforeEach(async () => {
    ({
      BridgeInstance,
      XC20HandlerInstance,
    } = await loadFixture(deploySourceChainContracts));
    [
      admin,
      depositor,
      recipient,
      EOA_Address,
    ] = await hre.viem.getWalletClients();


    resourceID1 = createResourceID(
      ERC20MintableInstance1.address,
      domainID
    );
    resourceID2 = createResourceID(
      ERC20MintableInstance2.address,
      domainID
    );

    burnableContractAddresses = [ERC20MintableInstance1.address];

    await ERC20MintableInstance1.write.mint([depositor.account!.address, initialTokenAmount]);

    await ERC20MintableInstance1.write.approve([
      XC20HandlerInstance.address,
      depositAmount
    ],
      {
        account: depositor.account
      }
    );
    await BridgeInstance.write.adminSetResource([
      XC20HandlerInstance.address,
      resourceID1,
      ERC20MintableInstance1.address,
      emptySetResourceData
    ]);
    await BridgeInstance.write.adminSetResource([
      XC20HandlerInstance.address,
      resourceID2,
      ERC20MintableInstance2.address,
      emptySetResourceData
    ]);
    await BridgeInstance.write.adminSetBurnable([
      XC20HandlerInstance.address,
      ERC20MintableInstance1.address
    ]);

    depositData = createERCDepositData(
      depositAmount,
      20,
      recipient
    );

    // set MPC address to unpause the Bridge
    await BridgeInstance.write.endKeygen([mpcAddress]);
  });

  it("[sanity] burnableContractAddresses should be marked as burnable", async () => {
    for (const burnableAddress of burnableContractAddresses) {
      const isBurnable = (await XC20HandlerInstance.read._tokenContractAddressToTokenProperties([
        burnableAddress
      ]));

      assert.isTrue(isBurnable, "Contract wasn't successfully marked burnable");
    }
  });
});
