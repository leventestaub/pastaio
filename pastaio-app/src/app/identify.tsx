/**
 * Identify screen (pushed). Four states:
 *   1. idle         — display title + two large outlined action buttons
 *   2. identifying  — image preview + spinner while backend works
 *   3. result       — image + KB-grounded shape info + Find recipes CTA + alternatives
 *   4. error        — image + warm error copy + Try another
 *
 * KB integration: after the backend returns a shape, we look it up to
 * render the canonical name + region context + description (FUNCTIONALITY_MAP
 * §6 trigger 2 — identification result enrichment).
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import Svg, { Path, Circle } from 'react-native-svg';

import { Text } from '@/components/primitives/Text';
import { ScreenHeader } from '@/components/primitives/ScreenHeader';
import { AskAffordance } from '@/components/primitives/AskAffordance';
import { colors, fonts, radii, space } from '@/constants/theme';

import { useSessionStore } from '@/stores/sessionStore';
import { backend, BackendError } from '@/services/backend';
import { getShape, type ShapeDetails } from '@/services/kb';
import type { IdentifyResponse } from '@/services/backendTypes';

// Mirrors app/schemas/identify.py :: UNKNOWN
const UNKNOWN_SHAPE = 'unknown';

type State =
  | { kind: 'idle' }
  | { kind: 'identifying'; imageUri: string }
  | { kind: 'result'; imageUri: string; response: IdentifyResponse; kbShape: ShapeDetails | null }
  | { kind: 'error'; imageUri: string; message: string };

export default function IdentifyScreen() {
  const setCurrentScreen = useSessionStore((s) => s.setCurrentScreen);
  const setActiveShape = useSessionStore((s) => s.setActiveShape);

  useFocusEffect(
      useCallback(() => {
        return () => setActiveShape(null);
      }, [setActiveShape]),
    );

  const openAgentInput = useSessionStore((s) => s.openAgentInput);

  const [state, setState] = useState<State>({ kind: 'idle' });

  useFocusEffect(
    useCallback(() => {
      setCurrentScreen('identify');
    }, [setCurrentScreen]),
  );

  const runIdentify = async (imageUri: string) => {
    setState({ kind: 'identifying', imageUri });
    try {
      const response = await backend.identify(imageUri);
      const kbShape = await getShape(response.shape).catch(() => null);
      // 'unknown' = not pasta or not a KB shape; don't feed it to the agent as a shape.
      setActiveShape(response.shape === UNKNOWN_SHAPE ? null : response.shape);
      setState({ kind: 'result', imageUri, response, kbShape });
    } catch (err) {
      const message = err instanceof BackendError ? err.message : String(err);
      setState({ kind: 'error', imageUri, message });
    }
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Camera permission needed',
        'Enable camera access in Settings to identify pasta.',
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      runIdentify(result.assets[0].uri);
    }
  };

  const pickFromLibrary = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Photo library permission needed',
        'Enable photo access in Settings to pick a pasta image.',
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: false,
    });
    if (!result.canceled && result.assets[0]) {
      runIdentify(result.assets[0].uri);
    }
  };

  const reset = () => setState({ kind: 'idle' });

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <ScreenHeader title="IDENTIFY" onBack={() => router.back()} />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 100, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >
        <Text
          variant="display"
          style={{ fontSize: 44, lineHeight: 44, marginBottom: 24 }}
        >
          What's the shape?
        </Text>

        {state.kind === 'idle' && (
          <View style={{ gap: 12 }}>
            <BigActionButton
              icon={<CameraIcon />}
              title="Take photo"
              subtitle="Use the camera"
              onPress={takePhoto}
            />
            <BigActionButton
              icon={<ImageIcon />}
              title="Pick from library"
              subtitle="Browse photos"
              onPress={pickFromLibrary}
            />
            <Text
              variant="meta"
              style={{ marginTop: 18, fontStyle: 'italic' }}
            >
              Best results: dry pasta, plain background, good light.
            </Text>
          </View>
        )}

        {state.kind === 'identifying' && (
          <View>
            <Image
              source={{ uri: state.imageUri }}
              style={{
                width: '100%',
                aspectRatio: 4 / 3,
                borderRadius: radii.md,
                marginBottom: 20,
                backgroundColor: colors.paper2,
              }}
            />
            <View style={{ alignItems: 'center', paddingTop: 8 }}>
              <ActivityIndicator color={colors.passata} />
              <Text
                variant="body"
                style={{ marginTop: 12, fontStyle: 'italic' }}
              >
                Identifying…
              </Text>
              <Text variant="meta" style={{ marginTop: 4 }}>
                First run can take 15s while the model loads.
              </Text>
            </View>
          </View>
        )}

        {state.kind === 'error' && (
          <View>
            <Image
              source={{ uri: state.imageUri }}
              style={{
                width: '100%',
                aspectRatio: 4 / 3,
                borderRadius: radii.md,
                marginBottom: 20,
                backgroundColor: colors.paper2,
              }}
            />
            <View style={{
              borderWidth: 1,
              borderColor: colors.passata,
              borderRadius: radii.md,
              padding: space.lg,
            }}>
              <Text variant="body">Identification failed.</Text>
              <Text variant="meta" style={{ marginTop: 4 }}>
                {state.message}
              </Text>
            </View>
            <Pressable
              onPress={reset}
              style={({ pressed }) => ({
                marginTop: 16,
                paddingVertical: 14,
                borderWidth: 1,
                borderColor: colors.hairlineStrong,
                borderRadius: radii.md,
                alignItems: 'center',
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text variant="body">Try another photo</Text>
            </Pressable>
          </View>
        )}

        {state.kind === 'result' && (
          <View>
            <Image
              source={{ uri: state.imageUri }}
              style={{
                width: '100%',
                aspectRatio: 4 / 3,
                borderRadius: radii.md,
                marginBottom: 20,
                backgroundColor: colors.paper2,
              }}
            />

            {state.response.shape !== UNKNOWN_SHAPE && (
              <Text variant="mono" accent>
                {Math.round(state.response.confidence * 100)}% match · {(state.response.latency_ms / 1000).toFixed(1)}s
              </Text>
            )}
            <Text
              variant="display"
              style={{ fontSize: 48, lineHeight: 48, marginTop: 4 }}
            >
              {state.response.shape === UNKNOWN_SHAPE
                ? 'Not sure.'
                : state.kbShape?.canonical_name ?? state.response.shape}
            </Text>

            {state.kbShape?.region_canonical_name && (
              <Text variant="mono" accent style={{ marginTop: 10 }}>
                From {state.kbShape.region_canonical_name}
              </Text>
            )}

            {state.kbShape && (
              <Text variant="body" style={{ marginTop: 8 }}>
                {state.kbShape.description.trim()}
              </Text>
            )}

            {state.response.shape === UNKNOWN_SHAPE ? (
              <Text variant="body" muted style={{ marginTop: 8 }}>
                This doesn't look like one of the shapes in the knowledge base. Try a closer photo of the dry pasta.
              </Text>
            ) : !state.kbShape && (
              <Text variant="body" muted style={{ marginTop: 8, fontStyle: 'italic' }}>
                Not in the local knowledge base yet.
              </Text>
            )}

            {state.response.shape !== UNKNOWN_SHAPE && (
              <Pressable
                onPress={() => router.push(`/shape/${state.response.shape}`)}
                style={({ pressed }) => ({
                  marginTop: 20,
                  paddingVertical: 14,
                  backgroundColor: colors.passata,
                  borderRadius: radii.md,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  opacity: pressed ? 0.92 : 1,
                })}
              >
                <Text style={{ fontFamily: fonts.sansSemibold, fontSize: 15, color: colors.bone }}>
                  Find recipes
                </Text>
                <Svg width={14} height={14} viewBox="0 0 24 24" fill="none">
                  <Path
                    d="M5 12 H 18 M 13 6 L 19 12 L 13 18"
                    stroke={colors.bone}
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </Svg>
              </Pressable>
            )}

            {state.response.alternatives.length > 0 && (
              <>
                <Text variant="mono" style={{ marginTop: 28, marginBottom: 10 }}>
                  Or maybe
                </Text>
                <View style={{ gap: 8 }}>
                  {state.response.alternatives.map(([altShape, altConf]) => (
                    <Pressable
                      key={altShape}
                      onPress={() => router.push(`/shape/${altShape}`)}
                      style={({ pressed }) => ({
                        backgroundColor: colors.paperHi,
                        borderWidth: 1,
                        borderColor: colors.hairline,
                        borderRadius: radii.md,
                        paddingVertical: 12,
                        paddingHorizontal: 16,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <Text variant="h3" style={{ color: colors.ink70 }}>{altShape}</Text>
                      <Text variant="meta">{Math.round(altConf * 100)}%</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}

            <Pressable
              onPress={reset}
              style={({ pressed }) => ({
                marginTop: 16,
                paddingVertical: 14,
                alignItems: 'center',
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text variant="body" muted>Try another photo</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>

      <AskAffordance variant="floating" onPress={openAgentInput} />
    </View>
  );
}

function BigActionButton({
  icon, title, subtitle, onPress,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 20,
        paddingHorizontal: 20,
        borderWidth: 1,
        borderColor: colors.hairlineStrong,
        borderRadius: radii.md,
        backgroundColor: colors.paperHi,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      {icon}
      <View>
        <Text variant="body" style={{ fontSize: 16, color: colors.ink }}>
          {title}
        </Text>
        <Text variant="meta" style={{ marginTop: 2 }}>
          {subtitle}
        </Text>
      </View>
    </Pressable>
  );
}

function CameraIcon() {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 8 H 7 L 9 5 H 15 L 17 8 H 21 V 19 H 3 Z"
        stroke={colors.passata}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={13} r={3.5} stroke={colors.passata} strokeWidth={1.6} />
    </Svg>
  );
}

function ImageIcon() {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M3 5 H 21 V 19 H 3 Z M 3 16 L 9 11 L 14 15 L 18 12 L 21 14"
        stroke={colors.passata}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={8} cy={9} r={1.4} fill={colors.passata} />
    </Svg>
  );
}
