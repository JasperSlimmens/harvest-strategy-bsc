// Utilities
const Utils = require("../utilities/Utils.js");
const {
  impersonates,
  setupCoreProtocol,
  depositVault,
  swapBNBToToken,
  swapBNBToTokenValue,
  addLiquidityValue
} = require("../utilities/hh-utils.js");

const { send } = require("@openzeppelin/test-helpers");
const BigNumber = require("bignumber.js");
const IBEP20 = artifacts.require("IBEP20");

//const Strategy = artifacts.require("");
const Strategy = artifacts.require("IronStrategyMainnet_IRON_STEEL");


// Vanilla Mocha test. Increased compatibility with tools that integrate Mocha.
describe("BSC Mainnet Value IRON/STEEL", function() {
  let accounts;
  // external contracts
  let underlying;

  // external setup
  let wbnb = "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c";
  let bnbbusdLP = "0x522361C3aa0d81D1726Fa7d40aA14505d0e097C9";
  let ironbusdLP = "0x09D6afB74E3a40b24425EE215fA367be971b4aF3";
  let steelbnbLP = "0xed2d6e9E400705f41C24dDa2e088ADbfD47C5818";
  let token0Addr = "0x7b65B489fE53fCE1F6548Db886C08aD73111DDd8";
  let token1Addr = "0x9001eE054F1692feF3A48330cB543b6FEc6287eb";

  // parties in the protocol
  let governance;
  let farmer1;

  // numbers used in tests
  let farmerBalance;

  // Core protocol contracts
  let controller;
  let vault;
  let strategy;

  async function setupExternalContracts() {
    underlying = await IBEP20.at("0xb85AeE0306422bA4972cdB9F4B32C6162E393ca4");
    console.log("Fetching Underlying at: ", underlying.address);
  }

  async function setupBalance(){
    token0 = await IBEP20.at(token0Addr);
    token1 = await IBEP20.at(token1Addr);
    await swapBNBToTokenValue(farmer1, token0Addr, [bnbbusdLP, ironbusdLP], "60" + "000000000000000000");
    farmerToken0Balance = await token0.balanceOf(farmer1);
    await swapBNBToTokenValue(farmer1, token1Addr, [steelbnbLP], "40" + "000000000000000000");
    farmerToken1Balance = await token1.balanceOf(farmer1);
    await addLiquidityValue(farmer1, token0, token1, farmerToken0Balance, farmerToken1Balance, underlying);
    farmerBalance = await underlying.balanceOf(farmer1);
  }

  before(async function() {
    governance = "0xf00dD244228F51547f0563e60bCa65a30FBF5f7f";
    accounts = await web3.eth.getAccounts();

    farmer1 = accounts[1];

    // impersonate accounts
    await impersonates([governance]);

    let etherGiver = accounts[9];
    await send.ether(etherGiver, governance, "100" + "000000000000000000")

    await setupExternalContracts();
    [controller, vault, strategy] = await setupCoreProtocol({
      "existingVaultAddress": null,
      "strategyArtifact": Strategy,
      "strategyArtifactIsUpgradable": true,
      "underlying": underlying,
      "governance": governance,
    });

    await strategy.setSellFloor(0, {from:governance});

    // whale send underlying to farmers
    await setupBalance();
  });

  describe("Happy path", function() {
    it("Farmer should earn money", async function() {
      let farmerOldBalance = new BigNumber(await underlying.balanceOf(farmer1));
      await depositVault(farmer1, underlying, vault, farmerBalance);

      // Using half days is to simulate how we doHardwork in the real world
      let hours = 10;
      let blocksPerHour = 2400;
      let oldSharePrice;
      let newSharePrice;
      for (let i = 0; i < hours; i++) {
        console.log("loop ", i);

        oldSharePrice = new BigNumber(await vault.getPricePerFullShare());
        await controller.doHardWork(vault.address, { from: governance });
        newSharePrice = new BigNumber(await vault.getPricePerFullShare());

        console.log("old shareprice: ", oldSharePrice.toFixed());
        console.log("new shareprice: ", newSharePrice.toFixed());
        console.log("growth: ", newSharePrice.toFixed() / oldSharePrice.toFixed());

        await Utils.advanceNBlock(blocksPerHour);
      }
      await vault.withdraw(new BigNumber(await vault.balanceOf(farmer1)).toFixed(), { from: farmer1 });
      let farmerNewBalance = new BigNumber(await underlying.balanceOf(farmer1));
      Utils.assertBNGt(farmerNewBalance, farmerOldBalance);

      apr = (farmerNewBalance.toFixed()/farmerOldBalance.toFixed()-1)*(24/(blocksPerHour*hours/1200))*365;
      apy = ((farmerNewBalance.toFixed()/farmerOldBalance.toFixed()-1)*(24/(blocksPerHour*hours/1200))+1)**365;

      console.log("earned!");
      console.log("APR:", apr*100, "%");
      console.log("APY:", (apy-1)*100, "%");

      await strategy.withdrawAllToVault({from:governance}); // making sure can withdraw all for a next switch

    });
  });
});
