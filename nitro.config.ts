import { defineConfig } from 'nitro'

// V3: pin to the EXISTING production Worker; do not let a local folder name
// determine the deployment target. Set the database ID as a Cloudflare BUILD
// variable after creating the D1 database; never commit real credentials.
const databaseId = process.env.SCARECROW_D1_DATABASE_ID?.trim()

export default defineConfig({
  preset: 'cloudflare_module',
  cloudflare: {
    wrangler: {
      name: 'scarecrow-scanner',
      ...(databaseId ? {
        d1_databases: [{
          binding: 'SCARECROW_DB',
          database_name: 'scarecrow-community',
          database_id: databaseId,
        }],
      } : {}),
    },
  },
})
