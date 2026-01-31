# Database Migrations

## Running Migrations

To create the presets table in your Supabase database:

### Option 1: Using Supabase Dashboard (Recommended)

1. Go to your Supabase project dashboard
2. Navigate to the **SQL Editor** section
3. Click **New Query**
4. Copy and paste the contents of `20250130_create_presets_table.sql`
5. Click **Run** to execute the migration

### Option 2: Using Supabase CLI

If you have the Supabase CLI installed:

```bash
supabase db push
```

## What This Migration Does

The `20250130_create_presets_table.sql` migration creates:

- **presets table**: Stores user photo editing presets from .xmp files
  - `id`: Unique identifier (UUID)
  - `user_id`: Reference to the user who owns the preset
  - `name`: Name of the preset (extracted from filename)
  - `settings`: JSON object containing all the adjustment values
  - `created_at`: Timestamp when preset was created
  - `updated_at`: Timestamp when preset was last updated

- **Indexes**: For faster queries on `user_id`, `created_at`, and `name` (for sorting)

- **Row Level Security (RLS) Policies**: Ensures users can only access their own presets

- **Auto-update trigger**: Automatically updates `updated_at` timestamp on modifications
