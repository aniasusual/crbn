// TEMPORARY PREVIEW PLACEHOLDER: The agent will replace this with your application.
import React from 'react';
import { StyleSheet, Text, View, Image } from 'react-native';
import logoImg from '../assets/imagelogo.png';

export default function App() {
  return (
    <View style={styles.container}>
      {/* Centerpiece Content */}
      <View style={styles.hero}>
        <View style={styles.logoWrap}>
          <Image
            source={logoImg}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        <View style={styles.content}>
          <Text style={styles.title}>Standing by</Text>
          <Text style={styles.subtitle}>Your preview will appear here.</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#06080d',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
  },
  logoWrap: {
    width: 140,
    height: 140,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 110,
    height: 110,
  },
  content: {
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontFamily: 'monospace',
    fontSize: 20,
    fontWeight: '600',
    letterSpacing: -0.2,
    color: '#ffffff',
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.65)',
    textAlign: 'center',
    lineHeight: 20,
  },
});
