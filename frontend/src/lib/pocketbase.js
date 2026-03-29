/**
 * PocketBase client for the React dashboard.
 * Connects to the local PocketBase instance for data + real-time subscriptions.
 */
import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

// Disable auto-cancellation for real-time subscriptions
pb.autoCancellation(false);

export default pb;
