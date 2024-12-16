// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

import hre from 'hardhat';
import {expect} from "chai";
import {ContractTypesMap} from 'hardhat/types';
import {WalletClient} from 'viem';
import {deploySourceChainContracts} from '../helpers';
import {loadFixture} from '@nomicfoundation/hardhat-network-helpers';


describe("Retry", () => {
    let RetryInstance: ContractTypesMap["Retry"];

    let admin: WalletClient;
    let nonadmin: WalletClient;

    const sourceDomainID = 1;
    const destinationDomainID = 2;
    const blockHeight = BigInt(15);
    const resourceID = "0x0000000000000000000000000000000000000000000000000000000000000300";

    before(async () => {
      ({
        RetryInstance,
      } = await loadFixture(deploySourceChainContracts));
      [
        admin,
        nonadmin
      ] = await hre.viem.getWalletClients();
    });

    it("should emit Retry event when retry is called by the owner", async () => {
      const retryTx = await RetryInstance.write.retry([
        sourceDomainID,
        destinationDomainID,
        blockHeight,
        resourceID
      ],
        {
          account: admin.account
        }
      );

        await expect(retryTx).to.emit(RetryInstance, "Retry").withArgs(
          sourceDomainID,
          destinationDomainID,
          blockHeight,
          resourceID
        );
    });

    it("should revert when retry is not called by the owner", async () => {
      await expect(
        RetryInstance.write.retry([
          sourceDomainID,
          destinationDomainID,
          blockHeight,
          resourceID
        ],
          {
            account: nonadmin.account
          }
        ),
      ).to.be.revertedWith("Ownable: caller is not the owner")
    });
})
