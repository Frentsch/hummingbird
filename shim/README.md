To start the GUI: 
```pnpm --filter @sui-shim/gui dev```
at http://localhost:3000

# 1. Start the daemon
pnpm exec sui-shim daemon --config shim.toml

# 2. One-shot calls (sign + submit directly, no daemon needed)
pnpm exec sui-shim call register-as `
  --isd-as-id 1 `
  --set-active

pnpm exec sui-shim call register-seller --save

pnpm exec sui-shim call create-interface `
  --interface-id 1 `

pnpm exec sui-shim call create-listing `
--interface-object-id <id> `
--interface-type = 0 `
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


# 3. Manage daemon callers while daemon is running
pnpm exec sui-shim callers add mysecretkey123
pnpm exec sui-shim callers list