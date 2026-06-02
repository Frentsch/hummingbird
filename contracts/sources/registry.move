module hummingbird::registry {
    use sui::object::{Self, ID, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};
    use sui::table::{Self, Table};
    use sui::event;
    use sui::derived_object;
    use sui::object_bag::{Self, ObjectBag};

    const EAsAlreadyRegistered: u64 = 0;
    const EInterfaceAlreadyExists: u64 = 1;
    const EUnauthorized: u64 = 2;

    /// Root shared object. Single instance, ID known at deploy time.
    struct GlobalRegistry has key {
        id: UID,
        as_registries: Table<u64, ID>,  // isd_as_id -> AsRegistry object ID
    }

    /// Per-AS shared object. ID recorded in GlobalRegistry.
    struct AsRegistry has key {
        id: UID,
        isd_as_id: u64,
        authority: address,
        interfaces: Table<u16, ID>,  // Interface id -> Interface object ID
    }

    // Interface holding its listings. Uniquely identified by isd_as_id & interface_id
    struct Interface has key {
        id: UID,
        isd_as_id: u64,
        interface_id: u16,
        listings: ObjectBag,
    }

    /// Capability that authorises the holder to register interfaces and create
    /// root listings under a specific AS.
    struct AsAuthCap has key, store {
        id: UID,
        isd_as_id: u64,
    }

    struct AsRegistered has copy, drop {
        isd_as_id: u64,
        registry_id: ID,
    }

    struct InterfaceRegistered has copy, drop {
        isd_as_id: u64,
        interface_object_id: ID,
        interface_id: u16,
    }

    // --- Bootstrap ---

    fun init(ctx: &mut TxContext) {
        transfer::share_object(GlobalRegistry {
            id: object::new(ctx),
            as_registries: table::new(ctx),
        });
    }

    // --- AS registration ---

    /// Register a new AS. Returns an AsAuthCap transferred to the caller.
    public fun register_as(
        global: &mut GlobalRegistry,
        isd_as_id: u64,
        ctx: &mut TxContext,
    ): AsAuthCap {
        assert!(!table::contains(&global.as_registries, isd_as_id), EAsAlreadyRegistered);
        let registry = AsRegistry {
            id: derived_object::claim(&mut global.id, isd_as_id),
            isd_as_id,
            authority: tx_context::sender(ctx),
            interfaces: table::new(ctx),
        };
        let registry_id = object::id(&registry);
        table::add(&mut global.as_registries, isd_as_id, registry_id);
        event::emit(AsRegistered { isd_as_id, registry_id });
        transfer::share_object(registry);
        AsAuthCap { id: object::new(ctx), isd_as_id }
    }

    #[lint_allow(self_transfer)]
    public entry fun register_as_to_sender(
        global: &mut GlobalRegistry,
        isd_as_id: u64,
        ctx: &mut TxContext,
    ) {
        let cap = register_as(global, isd_as_id, ctx);
        transfer::transfer(cap, tx_context::sender(ctx));
    }

    // --- Create new interface ---

    public fun create_interface(
        as_registry: &mut AsRegistry,
        cap: &AsAuthCap,
        interface_id: u16,
        ctx: &mut TxContext,
    ) {
        assert!(cap.isd_as_id == as_registry.isd_as_id, EUnauthorized);
        assert!(!table::contains(&as_registry.interfaces, interface_id), EInterfaceAlreadyExists);
        let interface = Interface {
            id: derived_object::claim(&mut as_registry.id, interface_id),
            isd_as_id: as_registry.isd_as_id,
            interface_id,
            listings: object_bag::new(ctx)
        };
        let interface_object_id = object::id(&interface);
        table::add(&mut as_registry.interfaces, interface_id, interface_object_id);
        event::emit(InterfaceRegistered {
            isd_as_id: as_registry.isd_as_id,
            interface_object_id,
            interface_id,
        });
        transfer::share_object(interface);
    }

   
    // --- Lookup helpers (read-only, used by clients and other modules) ---

    public fun get_as_registry_id(global: &GlobalRegistry, isd_as_id: u64): ID {
        *table::borrow(&global.as_registries, isd_as_id)
    }

    public fun get_interface_id(
        as_registry: &AsRegistry,
        interface_id: u16,
    ): ID {
        *table::borrow(&as_registry.interfaces,interface_id)
    }

    public fun cap_isd_as_id(cap: &AsAuthCap): u64 { cap.isd_as_id }
    public fun as_registry_isd_as_id(r: &AsRegistry): u64 { r.isd_as_id }
    public fun interface_isd_as_id(inter: &Interface): u64 { inter.isd_as_id }
    public fun interface_id(inter: &Interface): u16 { inter.interface_id }
    public fun interface_listings(inter: &mut Interface): &mut ObjectBag{ &mut inter.listings }
}
