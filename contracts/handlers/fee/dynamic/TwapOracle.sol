
// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only
pragma solidity 0.8.11;

import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Factory.sol';
import '@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol';
import "../../../utils/TickMath.sol";
import "../../../utils/FullMath.sol";
import "../../../utils/AccessControl.sol";

contract TwapOracle is AccessControl {
    IUniswapV3Factory public immutable UNISWAP_V3_FACTORY;
    address public immutable WETH;

    mapping(address => Pool) public pools;
    mapping(address => uint256) public prices;

    struct Pool {
        address poolAddress;
        uint32 timeWindow;
    }

    event PoolSet(address token, uint24 feeTier, uint32 timeWindow, address pool);
    event PriceSet(address token, uint256 price);

    error PairNotSupported();
    error InvalidTimeWindow();
    error InvalidPrice();
    error UniswapPoolAvailable();

    modifier onlyAdmin() {
        _onlyAdmin();
        _;
    }

    function _onlyAdmin() private view {
        require(hasRole(DEFAULT_ADMIN_ROLE, _msgSender()), "sender doesn't have admin role");
    }

    constructor(IUniswapV3Factory _uniswapFactory, address _weth) {
        UNISWAP_V3_FACTORY = _uniswapFactory;
        WETH = _weth;
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function getPrice(address quoteToken) external view returns (uint256 quotePrice) {
        Pool memory pool = pools[quoteToken];
        if (pool.poolAddress == address(0)) return prices[quoteToken];

        uint32 secondsAgo = pool.timeWindow;
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = secondsAgo;
        secondsAgos[1] = 0;

        (int56[] memory tickCumulatives, ) = IUniswapV3Pool(pool.poolAddress).observe(secondsAgos);
        int56 tickCumulativesDelta = tickCumulatives[1] - tickCumulatives[0];
        int24 arithmeticMeanTick = int24(tickCumulativesDelta / int56(uint56(secondsAgo)));
        // Always round to negative infinity
        if (tickCumulativesDelta < 0 && (tickCumulativesDelta % int56(uint56(secondsAgo)) != 0)) arithmeticMeanTick--;

        uint160 sqrtRatioX96 = TickMath.getSqrtRatioAtTick(arithmeticMeanTick);

        // Calculate quoteAmount with better precision if it doesn't overflow when multiplied by itself
        if (sqrtRatioX96 <= type(uint128).max) {
            uint256 ratioX192 = uint256(sqrtRatioX96) * sqrtRatioX96;
            quotePrice = quoteToken < WETH
                ? FullMath.mulDiv(ratioX192, 1e18, 1 << 192)
                : FullMath.mulDiv(1 << 192, 1e18, ratioX192);
        } else {
            uint256 ratioX128 = FullMath.mulDiv(sqrtRatioX96, sqrtRatioX96, 1 << 64);
            quotePrice = quoteToken < WETH
                ? FullMath.mulDiv(ratioX128, 1e18, 1 << 128)
                : FullMath.mulDiv(1 << 128, 1e18, ratioX128);
        }
        return quotePrice;
    }

    function setPool(address token, uint24 feeTier, uint32 timeWindow) external onlyAdmin {
        if (timeWindow == 0) revert InvalidTimeWindow();
        address _pool = UNISWAP_V3_FACTORY.getPool(WETH, token, feeTier);
        if (!Address.isContract(_pool)) revert PairNotSupported();
        pools[token].poolAddress = _pool;
        pools[token].timeWindow = timeWindow;
        emit PoolSet(token, feeTier, timeWindow, _pool);
    }

    function setPrice(address token, uint256 price) external onlyAdmin {
        prices[token] = price;
        delete pools[token];
        emit PriceSet(token, price);
    }
}
