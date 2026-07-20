To start the GUI: 
```pnpm --filter @sui-shim/gui dev```
at http://localhost:3000

# 1. Start the daemon
pnpm exec sui-shim daemon

# 2. Start the auth server
cd ../auth-server
go build cmd/auth-server/main.go
./main

# 3. Register AS
Currently requires the pubkey to be stored in auth-server/data/certs.
Follow the steps for registration as outlined in Justins tool (marketplace_account_client). Set marketplace_account_api to http://localhost:9091

# 4. Use Justin's tool to interact with the blockchain.
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