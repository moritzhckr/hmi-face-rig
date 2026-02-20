import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mixamoVRMRigMap } from './mixamoVRMRigMap.js';

/**
 * Load Mixamo animation from GLB file and retarget for VRM
 */
export async function loadMixamoAnimation(url, vrm) {
  const loader = new GLTFLoader();
  
  return new Promise((resolve, reject) => {
    loader.load(url, (gltf) => {
      // Extract animation from GLB
      let clip = null;
      
      // Try to find animation clip
      if (gltf.animations && gltf.animations.length > 0) {
        clip = gltf.animations[0];
        console.log('Found animation in gltf.animations:', clip.name);
      } 
      // Also check scene animations (for some GLB exporters)
      else if (gltf.scene && gltf.scene.animations && gltf.scene.animations.length > 0) {
        clip = gltf.scene.animations[0];
        console.log('Found animation in scene.animations:', clip.name);
      }
      
      if (!clip) {
        console.log('No animation found in GLB');
        resolve(null);
        return;
      }

      console.log('Processing animation:', clip.name, 'Duration:', clip.duration, 'Tracks:', clip.tracks.length);

      const tracks = [];
      const restRotationInverse = new THREE.Quaternion();
      const parentRestWorldRotation = new THREE.Quaternion();
      const _quatA = new THREE.Quaternion();

      // Get all bones from VRM scene for name mapping
      const sceneBoneMap = {};
      vrm.scene.traverse((obj) => {
        if (obj.isBone && obj.name) {
          sceneBoneMap[obj.name] = obj;
        }
      });
      const sceneBoneNames = Object.keys(sceneBoneMap);
      
      // Simple mapping: try to find matching bone in scene
      function findSceneBone(humanName) {
        // Complete mapping from English to Japanese VRM bone names
        const boneMap = {
          // Body
          'hips': 'J_Bip_C_Hips',
          'spine': 'J_Bip_C_Spine',
          'chest': 'J_Bip_C_Chest',
          'upperChest': 'J_Bip_C_UpperChest',
          'neck': 'J_Bip_C_Neck',
          'head': 'J_Bip_C_Head',
          // Left Arm
          'leftShoulder': 'J_Bip_L_UpperArm',
          'leftUpperArm': 'J_Bip_L_UpperArm',
          'leftLowerArm': 'J_Bip_L_LowerArm',
          'leftHand': 'J_Bip_L_Hand',
          // Right Arm
          'rightShoulder': 'J_Bip_R_UpperArm',
          'rightUpperArm': 'J_Bip_R_UpperArm',
          'rightLowerArm': 'J_Bip_R_LowerArm',
          'rightHand': 'J_Bip_R_Hand',
          // Left Leg
          'leftUpperLeg': 'J_Bip_L_UpperLeg',
          'leftLowerLeg': 'J_Bip_L_LowerLeg',
          'leftFoot': 'J_Bip_L_Foot',
          'leftToes': 'J_Bip_L_ToeBase',
          // Right Leg
          'rightUpperLeg': 'J_Bip_R_UpperLeg',
          'rightLowerLeg': 'J_Bip_R_LowerLeg',
          'rightFoot': 'J_Bip_R_Foot',
          'rightToes': 'J_Bip_R_ToeBase'
        };
        
        const japName = boneMap[humanName];
        if (japName && sceneBoneMap[japName]) return sceneBoneMap[japName];
        
        // Try partial match
        for (const name of sceneBoneNames) {
          if (name.toLowerCase().includes(humanName.toLowerCase()) || 
              (japName && name.toLowerCase().includes(japName.toLowerCase()))) {
            return sceneBoneMap[name];
          }
        }
        return null;
      }
      let motionHipsHeight = 1;
      let vrmHipsHeight = 1;
      
      // Find hips in GLB scene
      const hipsNode = gltf.scene.getObjectByName('mixamorigHips');
      if (hipsNode) {
        motionHipsHeight = hipsNode.position.y;
        console.log('Motion hips height:', motionHipsHeight);
      }
      
      if (vrm.humanoid?.normalizedRestPose?.hips) {
        vrmHipsHeight = vrm.humanoid.normalizedRestPose.hips.position[1];
      }
      
      const hipsPositionScale = vrmHipsHeight / motionHipsHeight;

      // Process each track
      clip.tracks.forEach((track) => {
        const trackSplitted = track.name.split('.');
        if (trackSplitted.length < 2) return;
        
        const mixamoRigName = trackSplitted[0];
        const vrmBoneName = mixamoVRMRigMap[mixamoRigName];
        
        if (!vrmBoneName) {
          // console.log('No mapping for:', mixamoRigName);
          return;
        }

        // Get the actual bone from VRM scene (not normalized)
        const vrmNode = findSceneBone(vrmBoneName);
        
        // Get mixamo bone from GLB scene
        const mixamoRigNode = gltf.scene.getObjectByName(mixamoRigName);

        if (!vrmNode) {
          console.log('VRM scene bone not found for:', vrmBoneName);
          return;
        }
        
        if (!mixamoRigNode) {
          console.log('Mixamo bone not found:', mixamoRigName);
          return;
        }

        const propertyName = trackSplitted[1];
        const targetBoneName = vrmNode.name; // Use actual scene bone name

        // Calculate rest pose rotations
        mixamoRigNode.getWorldQuaternion(restRotationInverse).invert();
        if (mixamoRigNode.parent) {
          mixamoRigNode.parent.getWorldQuaternion(parentRestWorldRotation);
        }

        if (track instanceof THREE.QuaternionKeyframeTrack) {
          // Retarget rotation
          const newValues = new Float32Array(track.values.length);
          
          for (let i = 0; i < track.values.length; i += 4) {
            _quatA.set(
              track.values[i],
              track.values[i + 1],
              track.values[i + 2],
              track.values[i + 3]
            );
            
            // Apply rotation retargeting formula
            _quatA.premultiply(parentRestWorldRotation).multiply(restRotationInverse);
            
            newValues[i] = _quatA.x;
            newValues[i + 1] = _quatA.y;
            newValues[i + 2] = _quatA.z;
            newValues[i + 3] = _quatA.w;
          }

          tracks.push(
            new THREE.QuaternionKeyframeTrack(
              `${targetBoneName}.${propertyName}`,
              track.times.slice(),
              newValues
            )
          );
        } else if (track instanceof THREE.VectorKeyframeTrack) {
          // Retarget position with hip scaling
          const value = track.values.map((v, i) => {
            const sign = (vrm.meta?.metaVersion === '0' && i % 3 !== 1 ? -v : v);
            return sign * hipsPositionScale;
          });
          
          tracks.push(new THREE.VectorKeyframeTrack(
            `${targetBoneName}.${propertyName}`,
            track.times.slice(),
            value
          ));
        }
      });

      console.log('Created retargeted tracks:', tracks.length);
      
      if (tracks.length > 0) {
        const newClip = new THREE.AnimationClip('vrmAnimation', clip.duration, tracks);
        resolve(newClip);
      } else {
        console.log('No tracks created');
        resolve(null);
      }
    }, undefined, reject);
  });
}
