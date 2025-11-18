// =============================================
// SUPABASE CONFIGURATION
// =============================================
// Replace these values with your actual Supabase credentials
// Get them from: https://app.supabase.com/project/YOUR_PROJECT/settings/api

const SUPABASE_CONFIG = {
  url: 'https://dfmdjwtcfvojosaizmmv.supabase.co', // Replace with your Project URL
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRmbWRqd3RjZnZvam9zYWl6bW12Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM0NTExNTIsImV4cCI6MjA3OTAyNzE1Mn0.nqNiPSRqD0fKLY4b3J5PSVK8Pv8B_iwaDm1mN_AIgkE' // Replace with your anon/public key
};

// Initialize Supabase client (will be used in script.js)
// Don't declare as const/let here to avoid conflicts - just assign to window
window.supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
