# Development

## publishing new contracts
To publish new contracts, first install the sui cli  
cd contracts  
rm Published.toml  
sui client publish  

Then copy the PackageID and GlobalRegistry ObjectID into the `shim/shim.toml`file, and copy the PackageID, GlobalRegistry ObjectID and MarketAdminCap ObjectId into `auth-server/auth-server.json` 

# Run
## 1. Start the daemon
cd shim
pnpm exec sui-shim daemon

## 2. Start the auth server
cd auth-server
go build cmd/auth-server/main.go
./main

## 2b. (testing only) Start MockAS instead of a real AS
## Answers every RedeemAssetFromASRequest with a canned response, useful for
## exercising the redemption flow without a real auth server.
cd shim
pnpm --filter @sui-shim/mock-as start

## 3. Register AS
### start auth-server
go build cmd/auth-server/main.go  
./main

### regsiter AS (Justin's tool)
./marketplace_client --register  
Currently requires the pubkey to be stored in auth-server/data/certs for vverification.
Follow the steps for registration as outlined in Justins tool (marketplace_account_client). Set marketplace_account_api to http://localhost:9091
Note that the jwt tokens returned are not needed since the local shim holds all crpytographic materials needed to interact with the marketplace.

## 4. Use Justin's tool to interact with the blockchain.
marketplace_client/main.go
marketplace is located at http://localhost:9091
Publish assets as the AS or buy assets as a client

# One-shot calls (sign + submit directly, no daemon needed)
pnpm exec sui-shim call register-as `
  --isd-as-id 1 `
  --set-active

pnpm exec sui-shim call register-seller --save

pnpm exec sui-shim call create-interface `
  --interface-id 1 `

pnpm exec sui-shim call create-listing `
--interface-object-id <id> `
--interface-type 0 `
--bandwidth 100 `
--start-time 1000 `
--exp-time 2000 `
--time-granularity 1 `
--min-bandwidth 1 `
--price 1 

pnpm exec sui-shim call list-listings `
--isd-as-id 1
--interface-id 1


pnpm exec sui-shim call buy-and-take `
--interface-object-id <id> `
--listing-id <id> `
--start-time 1200 `
--exp-time 1800 `
--bandwidth 10 `
--max-price 100000

# proto

pnpm proto:gen