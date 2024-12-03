pragma solidity 0.8.11;

interface IWETH {
    function withdraw(uint wad) external;
    function deposit() external payable;
}
