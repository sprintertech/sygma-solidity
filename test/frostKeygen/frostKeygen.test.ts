// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {loadFixture} from "@nomicfoundation/hardhat-network-helpers";
import {deploySourceChainContracts} from "../helpers";
import {ContractTypesMap} from "hardhat/types";
import {WalletClient} from 'viem';
import {expect} from 'chai';


describe("FROSTKeygen", () => {
    let FROSTKeygenInstance: ContractTypesMap["FROSTKeygen"];;
    let admin: WalletClient;
    let nonadmin: WalletClient;

    before(async () => {
      ({
        FROSTKeygenInstance,
      } = await loadFixture(deploySourceChainContracts));
      [
        admin,
        nonadmin
      ] = await hre.viem.getWalletClients();
    });

    it("should emit StartedFROSTKeygen event when startFROSTKeygen is called by the owner", async () => {
      const startKexgenTx = await FROSTKeygenInstance.write.startFROSTKeygen({account: admin.account})

      await expect(startKexgenTx).to.emit(FROSTKeygenInstance, "StartedFROSTKeygen");
    });

    it("should revert when startFROSTKeygen is not called by the owner", async () => {
      await expect(
        FROSTKeygenInstance.write.startFROSTKeygen({account: nonadmin.account}),
      ).to.be.reverted
    });

    it("should revert when keygen ended", async() => {
      const endKeygenTx = await FROSTKeygenInstance.write.endFROSTKeygen({account: admin.account})
      await expect(endKeygenTx).to.emit(FROSTKeygenInstance, "EndedFROSTKeygen");

      await expect(
        FROSTKeygenInstance.write.startFROSTKeygen({account: admin.account})
      ).to.be.reverted
    });

    it("should revert when end keygen not called by owner", async() => {
      await expect(
        FROSTKeygenInstance.write.endFROSTKeygen({account: nonadmin.account}),
      ).to.be.reverted
    });
})
