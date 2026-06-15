import { Command } from 'commander';
import { loadConfig, openReservationDb, queryReservations } from '@sui-shim/core';
import type { ReservationFilter } from '@sui-shim/core';

export function createReservationsCommand(): Command {
  const reservations = new Command('reservations').description('Manage stored reservations');

  reservations.addCommand(
    new Command('list')
      .description('List reservations stored in the local database')
      .option('-c, --config <path>', 'Path to shim.toml config file', 'shim.toml')
      .option('--ia <n>', 'Filter by ISD-AS id (u64)', BigInt)
      .option('--ingress-id <n>', 'Filter by ingress interface id', parseInt)
      .option('--egress-id <n>', 'Filter by egress interface id', parseInt)
      .option('--bw <n>', 'Filter by bandwidth (u64)', BigInt)
      .option('--starts-at <ISO>', 'Filter by starts_at (exact match, ISO 8601)')
      .option('--stops-at <ISO>', 'Filter by stops_at (exact match, ISO 8601)')
      .action(async (opts: {
        config: string;
        ia?: bigint;
        ingressId?: number;
        egressId?: number;
        bw?: bigint;
        startsAt?: string;
        stopsAt?: string;
      }) => {
        const config = await loadConfig(opts.config);
        const db = openReservationDb(config.db.path);

        const filter: ReservationFilter = {};
        if (opts.ia        !== undefined) filter.ia        = opts.ia;
        if (opts.ingressId !== undefined) filter.ingressId = opts.ingressId;
        if (opts.egressId  !== undefined) filter.egressId  = opts.egressId;
        if (opts.bw        !== undefined) filter.bw        = opts.bw;
        if (opts.startsAt  !== undefined) filter.startsAt  = new Date(opts.startsAt);
        if (opts.stopsAt   !== undefined) filter.stopsAt   = new Date(opts.stopsAt);

        const rows = queryReservations(db, filter);
        db.close();

        if (rows.length === 0) {
          console.log('No reservations found.');
          return;
        }

        const COL = { key: 6, resId: 20, ia: 20, ingress: 10, egress: 10, bw: 14, startsAt: 24, stopsAt: 24, ak: 20 };
        const header = [
          'Key'.padEnd(COL.key),
          'Res ID'.padEnd(COL.resId),
          'IA'.padEnd(COL.ia),
          'Ingress'.padEnd(COL.ingress),
          'Egress'.padEnd(COL.egress),
          'BW (kbps)'.padEnd(COL.bw),
          'Starts At'.padEnd(COL.startsAt),
          'Stops At'.padEnd(COL.stopsAt),
          'AK',
        ].join(' | ');
        const separator = '-'.repeat(header.length);
        console.log(separator);
        console.log(header);
        console.log(separator);

        for (const r of rows) {
          console.log([
            String(r.key).padEnd(COL.key),
            String(r.resId).padEnd(COL.resId),
            String(r.ia).padEnd(COL.ia),
            String(r.ingressId).padEnd(COL.ingress),
            String(r.egressId).padEnd(COL.egress),
            String(r.bw).padEnd(COL.bw),
            r.startsAt.toISOString().padEnd(COL.startsAt),
            r.stopsAt.toISOString().padEnd(COL.stopsAt),
            r.ak,
          ].join(' | '));
        }
        console.log(separator);
        console.log(`Total: ${rows.length} reservation(s).`);
      }),
  );

  return reservations;
}
