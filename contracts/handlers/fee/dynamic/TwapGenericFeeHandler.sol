// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.11;

import "./TwapFeeHandler.sol";

/**
    @title Handles deposit fees based on the destination chain's native coin price provided by Twap oracle.
    @author ChainSafe Systems.
    @notice This contract is intended to be used with the Bridge contract.
 */
contract TwapGenericFeeHandler is TwapFeeHandler {

    /**
        @param bridgeAddress Contract address of previously deployed Bridge.
        @param feeHandlerRouterAddress Contract address of previously deployed FeeHandlerRouter.
     */
    constructor(address bridgeAddress, address feeHandlerRouterAddress) TwapFeeHandler(bridgeAddress, feeHandlerRouterAddress) {
    }

    /**
        @notice Calculates fee for transaction cost.
        @param destinationDomainID ID of chain deposit will be bridged to.
        @param depositData Additional data to be passed to specified handler.
        @return fee Returns the fee amount.
        @return tokenAddress Returns the address of the token to be used for fee.
     */
    function _calculateFee(address, uint8, uint8 destinationDomainID, bytes32, bytes calldata depositData, bytes calldata) internal view override returns (uint256 fee, address tokenAddress) {
        uint256 maxFee = uint256(bytes32(depositData[:32]));
        uint256 destinationCoinPrice = twapOracle.getPrice(destinationNativeCoinWrap[destinationDomainID]);
        if (destinationCoinPrice == 0) revert IncorrectPrice();
        Fee memory destFeeConfig = destinationFee[destinationDomainID];

        uint256 txCost = destFeeConfig.gasPrice * maxFee * destinationCoinPrice / 1e18;
        if(destFeeConfig.feeType == ProtocolFeeType.Fixed) {
            txCost += destFeeConfig.amount;
        } else if (destFeeConfig.feeType == ProtocolFeeType.Percentage) {
            txCost += txCost * destFeeConfig.amount / 1e4; // 100 for percent and 100 to avoid precision loss;
        }

        return (txCost, address(0));
    }
}
