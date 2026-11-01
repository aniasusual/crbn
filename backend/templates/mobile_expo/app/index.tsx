import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ScrollView } from 'react-native';

const API_BASE = process.env.EXPO_PUBLIC_API_URL || 'http://127.0.0.1:5001/api';

interface ApiItem {
  id: string;
  title: string;
  completed?: boolean;
}

export default function HomeScreen() {
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<ApiItem[]>([]);
  const [apiStatus, setApiStatus] = useState<'connecting' | 'online' | 'offline'>('connecting');

  useEffect(() => {
    let isMounted = true;
    fetch(`${API_BASE}/items`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (isMounted) {
          setItems(Array.isArray(data) ? data : []);
          setApiStatus('online');
        }
      })
      .catch(() => {
        if (isMounted) setApiStatus('offline');
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.kicker}>Fullstack Mobile App</Text>
        <Text style={styles.title}>Expo + Express</Text>
        <Text style={styles.subtitle}>
          React Native client connected to Express API backend with live reload.
        </Text>
      </View>

      {/* Backend API Status Banner */}
      <View style={styles.apiCard}>
        <View style={styles.apiHeader}>
          <View
            style={[
              styles.statusDot,
              apiStatus === 'online'
                ? styles.statusDotOnline
                : apiStatus === 'connecting'
                ? styles.statusDotConnecting
                : styles.statusDotOffline,
            ]}
          />
          <Text style={styles.apiTitle}>
            {apiStatus === 'online'
              ? 'Backend API Connected'
              : apiStatus === 'connecting'
              ? 'Connecting to API...'
              : 'Backend Offline'}
          </Text>
        </View>
        <Text style={styles.apiEndpoint}>{API_BASE}/items</Text>
      </View>

      {/* Counter Card */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>Counter Interaction</Text>
        <Text style={styles.counterText}>{count}</Text>
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={styles.buttonSecondary}
            onPress={() => setCount((c) => Math.max(0, c - 1))}
          >
            <Text style={styles.buttonSecondaryText}>-</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.buttonPrimary}
            onPress={() => setCount((c) => c + 1)}
          >
            <Text style={styles.buttonPrimaryText}>Increment</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* API Data Items List */}
      {items.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Live Backend Tasks ({items.length})</Text>
          <View style={styles.itemsList}>
            {items.map((item) => (
              <View key={item.id} style={styles.itemRow}>
                <View style={[styles.itemDot, item.completed ? styles.itemDotDone : null]} />
                <Text style={styles.itemTitle}>{item.title}</Text>
              </View>
            ))}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#09090b',
  },
  content: {
    padding: 24,
    gap: 16,
  },
  header: {
    gap: 8,
    marginTop: 12,
  },
  kicker: {
    color: '#ea580c',
    fontSize: 11.5,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  title: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: 'rgba(255, 255, 255, 0.6)',
    fontSize: 14,
    lineHeight: 20,
  },
  apiCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    gap: 4,
  },
  apiHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  statusDotOnline: {
    backgroundColor: '#22c55e',
  },
  statusDotConnecting: {
    backgroundColor: '#f59e0b',
  },
  statusDotOffline: {
    backgroundColor: '#ef4444',
  },
  apiTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  apiEndpoint: {
    color: 'rgba(255, 255, 255, 0.4)',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  card: {
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    gap: 12,
  },
  cardLabel: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 11.5,
    textTransform: 'uppercase',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  counterText: {
    color: '#ffffff',
    fontSize: 40,
    fontWeight: '800',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  buttonPrimary: {
    flex: 1,
    backgroundColor: '#ea580c',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonPrimaryText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  buttonSecondary: {
    width: 44,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonSecondaryText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '600',
  },
  itemsList: {
    gap: 10,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  itemDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
  itemDotDone: {
    backgroundColor: '#22c55e',
  },
  itemTitle: {
    color: 'rgba(255, 255, 255, 0.85)',
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
});
