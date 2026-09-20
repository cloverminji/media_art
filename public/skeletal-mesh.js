/**
 * SkeletalMeshEngine - 관절 키네마틱스 & 2D 스킨드 메시 변형 엔진
 * 
 * 1. 계층 구조 (Hierarchical Structure):
 *    - Root(골반) -> Spine/Torso -> Neck -> Head
 *    - Neck -> Shoulders -> Elbows -> Hands (FK Chain)
 *    - Pelvis -> Hips -> Knees -> Feet (IK / FK Chain)
 * 
 * 2. 순운동학 (Forward Kinematics, FK):
 *    - 상위 관절(어깨/몸통)의 회전이 하위 관절(팔꿈치/손)로 연쇄 전파
 *    - 위상차(Phase Lag) 및 각속도 감쇠를 통해 자연스러운 팔 스윙 연출
 * 
 * 3. 역운동학 (Inverse Kinematics, IK):
 *    - 보행/댄스/점프 시 발의 접지면(Ground Contact) 및 스텝 목표 좌표를 기준으로
 *    - 2-Bone IK(엉덩이-무릎-발)를 해석적으로 풀어 무릎 굴곡 각도와 착지를 결정
 * 
 * 4. 메시 변형 & 스키닝 (Mesh Deformation & Skinning):
 *    - 캐릭터 이미지를 2D 삼각 메시 그리드로 세분화
 *    - 각 정점이 인접 뼈대(Bone)들에 미치는 거리 기반 가중치(Linear Blend Skinning)를 계산
 *    - 뼈대의 변환(Rotation + Translation)에 따라 정점들이 유기적으로 이동하여
 *      관절 부위가 고무줄처럼 매끄럽고 자연스럽게 휘어지도록 캔버스 2D 아핀 텍스처 매핑으로 렌더링
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SkeletalMeshEngine = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // 13 표준 조인트 정의
  const JOINT_NAMES = [
    'head', 'neck',
    'shoulder_l', 'elbow_l', 'hand_l',
    'shoulder_r', 'elbow_r', 'hand_r',
    'pelvis',
    'knee_l', 'foot_l',
    'knee_r', 'foot_r'
  ];

  // 10 뼈대(Bones) 정의 (시작 조인트 -> 끝 조인트)
  const BONE_DEFS = [
    { id: 'torso', from: 'neck', to: 'pelvis', radius: 45 },
    { id: 'head', from: 'neck', to: 'head', radius: 35 },
    { id: 'upper_arm_l', from: 'shoulder_l', to: 'elbow_l', radius: 25 },
    { id: 'lower_arm_l', from: 'elbow_l', to: 'hand_l', radius: 22 },
    { id: 'upper_arm_r', from: 'shoulder_r', to: 'elbow_r', radius: 25 },
    { id: 'lower_arm_r', from: 'elbow_r', to: 'hand_r', radius: 22 },
    { id: 'upper_leg_l', from: 'pelvis', to: 'knee_l', radius: 28 },
    { id: 'lower_leg_l', from: 'knee_l', to: 'foot_l', radius: 25 },
    { id: 'upper_leg_r', from: 'pelvis', to: 'knee_r', radius: 28 },
    { id: 'lower_leg_r', from: 'knee_r', to: 'foot_r', radius: 25 }
  ];

  // 벡터 유틸리티
  function dist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  function pointToSegmentDist(p, a, b) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const lenSq = abx * abx + aby * aby;
    if (lenSq === 0) return dist(p, a);

    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const t = clamp((apx * abx + apy * aby) / lenSq, 0, 1);
    const qx = a.x + t * abx;
    const qy = a.y + t * aby;
    return Math.hypot(p.x - qx, p.y - qy);
  }

  // 2-Bone IK 해석적 솔버 (골반/엉덩이 -> 무릎 -> 발)
  // a: 엉덩이, c: 목표 발 위치, l1: 허벅지 길이, l2: 종아리 길이, bendDir: 굴곡 부호 (+1: 오른쪽/앞, -1: 왼쪽/뒤)
  function solve2BoneIK(a, c, l1, l2, bendDir = 1) {
    const d = dist(a, c);
    const maxReach = (l1 + l2) * 0.999;
    const minReach = Math.abs(l1 - l2) * 1.001;
    const effectiveD = clamp(d, Math.max(0.01, minReach), maxReach);

    // 코사인 제2법칙
    // c^2 = a^2 + b^2 - 2ab cos(C)
    // l2^2 = l1^2 + d^2 - 2*l1*d*cos(alpha)
    const cosAlpha = (l1 * l1 + effectiveD * effectiveD - l2 * l2) / (2 * l1 * effectiveD);
    const alpha = Math.acos(clamp(cosAlpha, -1, 1));

    // 기본 벡터 각도 (a -> c)
    const baseAngle = Math.atan2(c.y - a.y, c.x - a.x);
    const kneeAngle = baseAngle + bendDir * alpha;

    return {
      x: a.x + Math.cos(kneeAngle) * l1,
      y: a.y + Math.sin(kneeAngle) * l1
    };
  }

  /**
   * 포즈 계산기 (Kinematics Solver)
   * 시간 t에 따라 13개 조인트의 변형된 위치를 FK 및 IK 원리로 계산
   */
  function solveSkeletonPose(bindSkel, motionType, time, facing = 1) {
    // 깊은 복사
    const pose = {};
    for (const k in bindSkel) {
      pose[k] = { x: bindSkel[k].x, y: bindSkel[k].y };
    }

    const pelvis0 = bindSkel.pelvis || { x: 100, y: 140 };
    const neck0 = bindSkel.neck || { x: 100, y: 65 };
    const head0 = bindSkel.head || { x: 100, y: 30 };

    const shoulderL0 = bindSkel.shoulder_l || { x: 60, y: 80 };
    const elbowL0 = bindSkel.elbow_l || { x: 40, y: 110 };
    const handL0 = bindSkel.hand_l || { x: 25, y: 135 };

    const shoulderR0 = bindSkel.shoulder_r || { x: 140, y: 80 };
    const elbowR0 = bindSkel.elbow_r || { x: 160, y: 110 };
    const handR0 = bindSkel.hand_r || { x: 175, y: 135 };

    const kneeL0 = bindSkel.knee_l || { x: 80, y: 180 };
    const footL0 = bindSkel.foot_l || { x: 75, y: 220 };
    const kneeR0 = bindSkel.knee_r || { x: 120, y: 180 };
    const footR0 = bindSkel.foot_r || { x: 125, y: 220 };

    // 뼈대 기본 길이
    const armL1 = dist(shoulderL0, elbowL0) || 35;
    const armL2 = dist(elbowL0, handL0) || 30;
    const armR1 = dist(shoulderR0, elbowR0) || 35;
    const armR2 = dist(elbowR0, handR0) || 30;

    const legL1 = dist(pelvis0, kneeL0) || 45;
    const legL2 = dist(kneeL0, footL0) || 45;
    const legR1 = dist(pelvis0, kneeR0) || 45;
    const legR2 = dist(kneeR0, footR0) || 45;

    // 바운스 및 틸트 변수
    let rootDx = 0;
    let rootDy = 0;
    let pelvisTilt = 0;
    let spineTilt = 0;
    let headTilt = 0;

    // 팔 FK 각도 (상박, 하박)
    let armLAngle1 = Math.atan2(elbowL0.y - shoulderL0.y, elbowL0.x - shoulderL0.x);
    let armLAngle2 = Math.atan2(handL0.y - elbowL0.y, handL0.x - elbowL0.x);
    let armRAngle1 = Math.atan2(elbowR0.y - shoulderR0.y, elbowR0.x - shoulderR0.x);
    let armRAngle2 = Math.atan2(handR0.y - elbowR0.y, handR0.x - elbowR0.x);

    // 발 IK 목표 위치
    let footTargetL = { x: footL0.x, y: footL0.y };
    let footTargetR = { x: footR0.x, y: footR0.y };
    let useLegIK = true;
    let kneeBendDirL = -1;
    let kneeBendDirR = 1;

    // 모션별 물리 및 키네마틱스
    const motion = motionType || 'walk';

    if (motion === 'dance_full' || motion === 'dance') {
      // ----------------------------------------------------
      // 1. 전신 댄스 (Full Body Dance & Groove)
      // ----------------------------------------------------
      const beat = time * 4.8;
      rootDx = Math.sin(beat * 0.5) * 12;
      rootDy = -Math.abs(Math.sin(beat)) * 14;
      pelvisTilt = Math.sin(beat * 0.5) * 0.16;
      spineTilt = -pelvisTilt * 0.8 + Math.sin(beat) * 0.08;
      headTilt = Math.sin(beat * 1.5) * 0.12;

      // 팔 FK: 신나는 양팔 댄스 스윙 (어깨 회전 + 팔꿈치 위상차)
      const armSwing = Math.sin(beat) * 0.85;
      armLAngle1 += armSwing - 0.4;
      armLAngle2 = armLAngle1 + Math.sin(beat + 0.6) * 0.9 + 0.5;

      armRAngle1 -= armSwing + 0.4;
      armRAngle2 = armRAngle1 - Math.sin(beat + 0.6) * 0.9 - 0.5;

      // 발 IK: 좌우 번갈아 탭 댄스 스텝
      const stepL = Math.max(0, Math.sin(beat));
      const stepR = Math.max(0, -Math.sin(beat));
      footTargetL.x = footL0.x + Math.sin(beat * 0.5) * 10;
      footTargetL.y = footL0.y - stepL * 16;
      footTargetR.x = footR0.x + Math.sin(beat * 0.5) * 10;
      footTargetR.y = footR0.y - stepR * 16;

    } else if (motion === 'dance_lower') {
      // ----------------------------------------------------
      // 2. 하체 댄스 (Lower Body Bounce & Shuffle Kick)
      // ----------------------------------------------------
      const beat = time * 5.2;
      const squat = Math.max(0, Math.sin(beat));
      rootDy = -squat * 18;
      pelvisTilt = Math.sin(beat * 0.5) * 0.12;
      spineTilt = -pelvisTilt * 0.6;
      headTilt = Math.sin(beat * 0.5) * 0.08;

      // 팔 FK: 가벼운 리듬 가드 (허리춤에서 바운스)
      armLAngle1 += Math.sin(beat * 0.5) * 0.25;
      armLAngle2 = armLAngle1 + 0.6 + Math.sin(beat) * 0.3;
      armRAngle1 -= Math.sin(beat * 0.5) * 0.25;
      armRAngle2 = armRAngle1 - 0.6 - Math.sin(beat) * 0.3;

      // 발 IK: 스쿼트 앤 킥
      const kickPhase = Math.sin(beat * 0.5);
      if (kickPhase > 0.2) {
        // 왼발 킥!
        footTargetL.x = footL0.x + 18;
        footTargetL.y = footL0.y - 25 * kickPhase;
        footTargetR.y = footR0.y + rootDy * 0.2;
      } else if (kickPhase < -0.2) {
        // 오른발 킥!
        footTargetR.x = footR0.x - 18;
        footTargetR.y = footR0.y + 25 * kickPhase;
        footTargetL.y = footL0.y + rootDy * 0.2;
      } else {
        // 착지 스쿼트
        footTargetL.y = footL0.y;
        footTargetR.y = footR0.y;
      }

    } else if (motion === 'funny') {
      // ----------------------------------------------------
      // 3. 웃긴 젤리 댄스 (Wobbly Comic Bounce)
      // ----------------------------------------------------
      rootDx = Math.sin(time * 3.6) * 14 + Math.sin(time * 7.2) * 6;
      rootDy = Math.sin(time * 2.8) * 12;
      pelvisTilt = Math.sin(time * 4.2) * 0.22;
      spineTilt = Math.sin(time * 5.0 + 1.0) * 0.25;
      headTilt = Math.sin(time * 6.5) * 0.30;

      // 팔 FK: 문어처럼 흐느적거리는 젤리 스윙
      armLAngle1 += Math.sin(time * 5.5) * 1.2;
      armLAngle2 = armLAngle1 + Math.sin(time * 7.0) * 1.4;

      armRAngle1 += Math.cos(time * 5.5) * 1.2;
      armRAngle2 = armRAngle1 - Math.cos(time * 7.0) * 1.4;

      // 발 IK: 뒤뚱거리는 보폭
      footTargetL.x = footL0.x + Math.sin(time * 3.6) * 18;
      footTargetL.y = footL0.y - Math.abs(Math.sin(time * 2.8)) * 14;
      footTargetR.x = footR0.x - Math.sin(time * 3.6) * 18;
      footTargetR.y = footR0.y - Math.abs(Math.cos(time * 2.8)) * 14;

    } else if (motion === 'jump') {
      // ----------------------------------------------------
      // 4. 점프 모션 (Squat - Launch - Fly - Cushion Land)
      // ----------------------------------------------------
      const jumpCycle = (time * 1.6) % 2.0; // 0~2초 주기
      let jumpY = 0;
      let squatAmount = 0;

      if (jumpCycle < 0.45) {
        // 준비 단계 (Squat): 엉덩이 깊게 내리기
        const p = jumpCycle / 0.45;
        squatAmount = Math.sin(p * Math.PI) * 22;
        jumpY = squatAmount;
        pelvisTilt = 0;
        spineTilt = 0.08;
        headTilt = -0.12;

        // 팔 모으기
        armLAngle1 += 0.3;
        armLAngle2 = armLAngle1 + 0.8;
        armRAngle1 -= 0.3;
        armRAngle2 = armRAngle1 - 0.8;

        footTargetL.y = footL0.y;
        footTargetR.y = footR0.y;

      } else if (jumpCycle < 1.35) {
        // 비상 및 체공 단계 (Fly): 공중으로 도약
        const p = (jumpCycle - 0.45) / 0.9;
        const flight = Math.sin(p * Math.PI);
        jumpY = -flight * 45;
        spineTilt = -0.05;
        headTilt = 0.08;

        // 팔 활짝 만세!
        armLAngle1 -= 1.4;
        armLAngle2 = armLAngle1 - 0.4;
        armRAngle1 += 1.4;
        armRAngle2 = armRAngle1 + 0.4;

        // 공중에서 다리 펴기
        footTargetL.y = footL0.y + jumpY * 0.75 + 10;
        footTargetR.y = footR0.y + jumpY * 0.75 + 10;

      } else {
        // 착지 및 충격 흡수 (Cushion)
        const p = (jumpCycle - 1.35) / 0.65;
        const cushion = (1 - p) * 14;
        jumpY = cushion;
        armLAngle1 += cushion * 0.02;
        armRAngle1 -= cushion * 0.02;

        footTargetL.y = footL0.y;
        footTargetR.y = footR0.y;
      }
      rootDy = jumpY;

    } else if (motion === 'swim') {
      // ----------------------------------------------------
      // 5. 유영 (Aquatic Wave FK - 부드러운 유선형 물결)
      // ----------------------------------------------------
      useLegIK = false; // 수영은 꼬리/다리가 유기적 사인파 FK로 흔들림
      const swimFreq = time * 3.4;
      rootDy = Math.sin(swimFreq) * 6;
      pelvisTilt = Math.sin(swimFreq) * 0.12;
      spineTilt = Math.sin(swimFreq - 0.6) * 0.15;
      headTilt = Math.sin(swimFreq - 1.2) * 0.10;

      // 가슴 지느러미 / 양팔 노젓기
      const paddle = Math.sin(swimFreq) * 0.45;
      armLAngle1 += paddle;
      armLAngle2 = armLAngle1 + Math.sin(swimFreq - 0.4) * 0.3;
      armRAngle1 -= paddle;
      armRAngle2 = armRAngle1 - Math.sin(swimFreq - 0.4) * 0.3;

      // 꼬리/다리 유기적 사인파
      const legWaveL = Math.sin(swimFreq - 1.0) * 16;
      const legWaveR = Math.sin(swimFreq - 1.4) * 16;

      pose.knee_l = { x: kneeL0.x + legWaveL * 0.6, y: kneeL0.y + rootDy };
      pose.foot_l = { x: footL0.x + legWaveL, y: footL0.y + rootDy };
      pose.knee_r = { x: kneeR0.x + legWaveR * 0.6, y: kneeR0.y + rootDy };
      pose.foot_r = { x: footR0.x + legWaveR, y: footR0.y + rootDy };

    } else {
      // ----------------------------------------------------
      // 6. 워킹 (Harmonic Walk Cycle with Ground-Contact IK)
      // ----------------------------------------------------
      const walkSpeed = time * 4.2;
      // 1보행 주기당 2회 바운스
      rootDy = -Math.abs(Math.sin(walkSpeed)) * 8;
      pelvisTilt = Math.sin(walkSpeed) * 0.08;
      // 상체 카운터 틸트 (보행 시 균형 제어)
      spineTilt = -pelvisTilt * 0.75;
      headTilt = Math.sin(walkSpeed * 0.5) * 0.05;

      // 팔 순운동학 (FK): 반대쪽 다리와 반대로 자연스럽게 교차 스윙
      const armSwing = Math.sin(walkSpeed) * 0.55;
      armLAngle1 += armSwing;
      // 팔꿈치는 상박을 따라가면서 관성 지연으로 약간 더 접힘 (자연스러운 2차 관성)
      armLAngle2 = armLAngle1 + Math.max(0, -Math.cos(walkSpeed) * 0.4) + 0.15;

      armRAngle1 -= armSwing;
      armRAngle2 = armRAngle1 - Math.max(0, Math.cos(walkSpeed) * 0.4) - 0.15;

      // 발 역운동학 (IK): 지면 지지기(Stance)와 공중 유각기(Swing)
      const phaseL = walkSpeed;
      const phaseR = walkSpeed + Math.PI;

      // 왼발
      const stepLiftL = Math.max(0, Math.sin(phaseL));
      footTargetL.x = footL0.x + Math.cos(phaseL) * 16;
      footTargetL.y = footL0.y - stepLiftL * 14;

      // 오른발
      const stepLiftR = Math.max(0, Math.sin(phaseR));
      footTargetR.x = footR0.x + Math.cos(phaseR) * 16;
      footTargetR.y = footR0.y - stepLiftR * 14;
    }

    // ----------------------------------------------------
    // 계층적 위치 갱신 (Hierarchical Forward Propagation)
    // ----------------------------------------------------
    // 1. Root: Pelvis
    pose.pelvis.x = pelvis0.x + rootDx;
    pose.pelvis.y = pelvis0.y + rootDy;

    // 2. Spine & Torso: Neck
    const spineVecX = neck0.x - pelvis0.x;
    const spineVecY = neck0.y - pelvis0.y;
    const cosSpine = Math.cos(spineTilt);
    const sinSpine = Math.sin(spineTilt);
    pose.neck.x = pose.pelvis.x + (spineVecX * cosSpine - spineVecY * sinSpine);
    pose.neck.y = pose.pelvis.y + (spineVecX * sinSpine + spineVecY * cosSpine);

    // 3. Head (부모: Neck)
    const headVecX = head0.x - neck0.x;
    const headVecY = head0.y - neck0.y;
    const totalHeadTilt = spineTilt + headTilt;
    const cosHead = Math.cos(totalHeadTilt);
    const sinHead = Math.sin(totalHeadTilt);
    pose.head.x = pose.neck.x + (headVecX * cosHead - headVecY * sinHead);
    pose.head.y = pose.neck.y + (headVecX * sinHead + headVecY * cosHead);

    // 4. Left Arm (Shoulder -> Elbow -> Hand, FK)
    const sVecLX = shoulderL0.x - neck0.x;
    const sVecLY = shoulderL0.y - neck0.y;
    pose.shoulder_l.x = pose.neck.x + (sVecLX * cosSpine - sVecLY * sinSpine);
    pose.shoulder_l.y = pose.neck.y + (sVecLX * sinSpine + sVecLY * cosSpine);

    pose.elbow_l.x = pose.shoulder_l.x + Math.cos(armLAngle1) * armL1;
    pose.elbow_l.y = pose.shoulder_l.y + Math.sin(armLAngle1) * armL1;

    pose.hand_l.x = pose.elbow_l.x + Math.cos(armLAngle2) * armL2;
    pose.hand_l.y = pose.elbow_l.y + Math.sin(armLAngle2) * armL2;

    // 5. Right Arm (Shoulder -> Elbow -> Hand, FK)
    const sVecRX = shoulderR0.x - neck0.x;
    const sVecRY = shoulderR0.y - neck0.y;
    pose.shoulder_r.x = pose.neck.x + (sVecRX * cosSpine - sVecRY * sinSpine);
    pose.shoulder_r.y = pose.neck.y + (sVecRX * sinSpine + sVecRY * cosSpine);

    pose.elbow_r.x = pose.shoulder_r.x + Math.cos(armRAngle1) * armR1;
    pose.elbow_r.y = pose.shoulder_r.y + Math.sin(armRAngle1) * armR1;

    pose.hand_r.x = pose.elbow_r.x + Math.cos(armRAngle2) * armR2;
    pose.hand_r.y = pose.elbow_r.y + Math.sin(armRAngle2) * armR2;

    // 6. Legs (2-Bone IK)
    if (useLegIK) {
      // 엉덩이(Hip) 좌표 (골반 중심 기준 약간 좌우 오프셋)
      const hipOffsetLX = (kneeL0.x - pelvis0.x) * 0.4;
      const hipOffsetRX = (kneeR0.x - pelvis0.x) * 0.4;
      const hipL = { x: pose.pelvis.x + hipOffsetLX, y: pose.pelvis.y };
      const hipR = { x: pose.pelvis.x + hipOffsetRX, y: pose.pelvis.y };

      // 왼다리 2-Bone IK
      pose.knee_l = solve2BoneIK(hipL, footTargetL, legL1, legL2, kneeBendDirL);
      pose.foot_l = footTargetL;

      // 오른다리 2-Bone IK
      pose.knee_r = solve2BoneIK(hipR, footTargetR, legR1, legR2, kneeBendDirR);
      pose.foot_r = footTargetR;
    }

    return pose;
  }

  /**
   * 2D 삼각 메시 스킨드 디포머 (Skinned Mesh Deformer)
   * 정적 이미지를 관절 뼈대들의 위치에 따라 유기적으로 휘어지게 렌더링
   */
  class SkinnedMesh {
    constructor(imageSource, bindSkeleton, width, height, gridCols = 8, gridRows = 10) {
      this.image = imageSource;
      this.bindSkeleton = bindSkeleton;
      this.width = width;
      this.height = height;
      this.gridCols = gridCols;
      this.gridRows = gridRows;

      this.vertices = [];   // 원본 정점 (u, v)
      this.weights = [];    // 정점별 뼈대 가중치 [{ boneIndex, weight }, ...]
      this.triangles = [];  // [i0, i1, i2]
      this.bones = [];      // 뼈대 목록

      this._initBones();
      this._buildMesh();
      this._computeWeights();
    }

    _initBones() {
      this.bones = BONE_DEFS.map((def, idx) => {
        const fromPt = this.bindSkeleton[def.from] || { x: this.width * 0.5, y: this.height * 0.5 };
        const toPt = this.bindSkeleton[def.to] || { x: this.width * 0.5, y: this.height * 0.5 };
        const midX = (fromPt.x + toPt.x) * 0.5;
        const midY = (fromPt.y + toPt.y) * 0.5;
        const length = dist(fromPt, toPt) || 1;
        const angle = Math.atan2(toPt.y - fromPt.y, toPt.x - fromPt.x);

        return {
          idx,
          id: def.id,
          fromKey: def.from,
          toKey: def.to,
          radius: def.radius,
          bindFrom: { x: fromPt.x, y: fromPt.y },
          bindTo: { x: toPt.x, y: toPt.y },
          bindMid: { x: midX, y: midY },
          bindLength: length,
          bindAngle: angle
        };
      });
    }

    _buildMesh() {
      const cols = this.gridCols;
      const rows = this.gridRows;
      this.vertices = [];
      this.triangles = [];

      for (let r = 0; r <= rows; r++) {
        const v = (r / rows) * this.height;
        for (let c = 0; c <= cols; c++) {
          const u = (c / cols) * this.width;
          this.vertices.push({ u, v, x: u, y: v });
        }
      }

      // 두 개의 삼각형으로 쿼드 분할
      const stride = cols + 1;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i0 = r * stride + c;
          const i1 = i0 + 1;
          const i2 = (r + 1) * stride + c;
          const i3 = i2 + 1;

          this.triangles.push([i0, i1, i2]);
          this.triangles.push([i1, i3, i2]);
        }
      }
    }

    _computeWeights() {
      this.weights = [];

      for (let i = 0; i < this.vertices.length; i++) {
        const p = { x: this.vertices[i].u, y: this.vertices[i].v };
        const rawWeights = [];
        let totalW = 0;

        for (let b = 0; b < this.bones.length; b++) {
          const bone = this.bones[b];
          const d = pointToSegmentDist(p, bone.bindFrom, bone.bindTo);
          // 거리 기반 역승 가중치 (관절 중심부일수록 1.0에 수렴, 경계선은 부드러운 스킨 블렌딩)
          const w = 1 / Math.pow(d + 12, 2.2);
          rawWeights.push({ boneIdx: b, w });
          totalW += w;
        }

        // 상위 3개 주요 뼈대만 선별하여 정규화 (성능 극대화 & 안정적 스키닝)
        rawWeights.sort((a, b) => b.w - a.w);
        const topWeights = rawWeights.slice(0, 3);
        let topTotal = topWeights.reduce((sum, item) => sum + item.w, 0);

        if (topTotal <= 0) {
          this.weights.push([{ boneIdx: 0, weight: 1.0 }]);
        } else {
          this.weights.push(
            topWeights.map(item => ({
              boneIdx: item.boneIdx,
              weight: item.w / topTotal
            }))
          );
        }
      }
    }

    /**
     * 포즈가 적용된 뼈대 변환 행렬들 계산
     */
    _computeBoneTransforms(currSkeleton) {
      const transforms = [];

      for (let b = 0; b < this.bones.length; b++) {
        const bone = this.bones[b];
        const fromPt = currSkeleton[bone.fromKey] || bone.bindFrom;
        const toPt = currSkeleton[bone.toKey] || bone.bindTo;

        const currMidX = (fromPt.x + toPt.x) * 0.5;
        const currMidY = (fromPt.y + toPt.y) * 0.5;
        const currLen = dist(fromPt, toPt) || 1;
        const currAngle = Math.atan2(toPt.y - fromPt.y, toPt.x - fromPt.x);

        const deltaAngle = currAngle - bone.bindAngle;
        const scale = bone.bindLength > 0 ? currLen / bone.bindLength : 1;

        transforms.push({
          bindMid: bone.bindMid,
          currMid: { x: currMidX, y: currMidY },
          cos: Math.cos(deltaAngle) * scale,
          sin: Math.sin(deltaAngle) * scale
        });
      }

      return transforms;
    }

    /**
     * 실시간 스킨드 변형 렌더링
     */
    draw(ctx, currSkeleton, destX, destY, destW, destH) {
      if (!this.image) return;

      const transforms = this._computeBoneTransforms(currSkeleton);
      const scaleX = destW / this.width;
      const scaleY = destH / this.height;

      // 1. 각 정점의 변형된 위치 계산 (Linear Blend Skinning)
      const deformedVerts = new Array(this.vertices.length);

      for (let i = 0; i < this.vertices.length; i++) {
        const vert = this.vertices[i];
        const wList = this.weights[i];
        let sumX = 0;
        let sumY = 0;

        for (let k = 0; k < wList.length; k++) {
          const bIdx = wList[k].boneIdx;
          const weight = wList[k].weight;
          const t = transforms[bIdx];

          // 로컬 중심 기준 회전 및 이동
          const lx = vert.u - t.bindMid.x;
          const ly = vert.v - t.bindMid.y;
          const rx = lx * t.cos - ly * t.sin + t.currMid.x;
          const ry = lx * t.sin + ly * t.cos + t.currMid.y;

          sumX += rx * weight;
          sumY += ry * weight;
        }

        deformedVerts[i] = {
          x: destX + sumX * scaleX,
          y: destY + sumY * scaleY
        };
      }

      // 2. 캔버스 2D 아핀 삼각형 텍스처 매핑
      const tris = this.triangles;
      const verts = this.vertices;

      for (let t = 0; t < tris.length; t++) {
        const tri = tris[t];
        const i0 = tri[0], i1 = tri[1], i2 = tri[2];

        // 원본 UV
        const u0 = verts[i0].u, v0 = verts[i0].v;
        const u1 = verts[i1].u, v1 = verts[i1].v;
        const u2 = verts[i2].u, v2 = verts[i2].v;

        // 변형된 화면 좌표
        const d0 = deformedVerts[i0];
        const d1 = deformedVerts[i1];
        const d2 = deformedVerts[i2];

        // 삼각형 클립 마진 확장 (캔버스 앤티앨리어싱 이음매 seam 방지)
        const cx = (d0.x + d1.x + d2.x) / 3;
        const cy = (d0.y + d1.y + d2.y) / 3;
        const expand = 0.65; // px

        const p0x = d0.x + (d0.x - cx) * 0.04 + (d0.x >= cx ? expand : -expand) * 0.3;
        const p0y = d0.y + (d0.y - cy) * 0.04 + (d0.y >= cy ? expand : -expand) * 0.3;
        const p1x = d1.x + (d1.x - cx) * 0.04 + (d1.x >= cx ? expand : -expand) * 0.3;
        const p1y = d1.y + (d1.y - cy) * 0.04 + (d1.y >= cy ? expand : -expand) * 0.3;
        const p2x = d2.x + (d2.x - cx) * 0.04 + (d2.x >= cx ? expand : -expand) * 0.3;
        const p2y = d2.y + (d2.y - cy) * 0.04 + (d2.y >= cy ? expand : -expand) * 0.3;

        // 2D 아핀 변환 행렬 풀기
        const delta = u0 * (v1 - v2) + u1 * (v2 - v0) + u2 * (v0 - v1);
        if (Math.abs(delta) < 0.001) continue;

        const a = (d0.x * (v1 - v2) + d1.x * (v2 - v0) + d2.x * (v0 - v1)) / delta;
        const b = (d0.y * (v1 - v2) + d1.y * (v2 - v0) + d2.y * (v0 - v1)) / delta;
        const c = (d0.x * (u2 - u1) + d1.x * (u0 - u2) + d2.x * (u1 - u0)) / delta;
        const d = (d0.y * (u2 - u1) + d1.y * (u0 - u2) + d2.y * (u1 - u0)) / delta;
        const e = (d0.x * (u1 * v2 - u2 * v1) + d1.x * (u2 * v0 - u0 * v2) + d2.x * (u0 * v1 - u1 * v0)) / delta;
        const f = (d0.y * (u1 * v2 - u2 * v1) + d1.y * (u2 * v0 - u0 * v2) + d2.x * (u0 * v1 - u1 * v0)) / delta;

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(p0x, p0y);
        ctx.lineTo(p1x, p1y);
        ctx.lineTo(p2x, p2y);
        ctx.closePath();
        ctx.clip();

        ctx.transform(a, b, c, d, e, f);
        ctx.drawImage(this.image, 0, 0);
        ctx.restore();
      }
    }
  }

  /**
   * 관절 뼈대 및 노드 오버레이 디버거/시각화 도구
   */
  function drawSkeletonOverlay(ctx, skeleton, destX, destY, scaleX, scaleY, options = {}) {
    if (!skeleton) return;
    const alpha = options.alpha !== undefined ? options.alpha : 0.9;
    const lineWidth = options.lineWidth || 2.5;

    ctx.save();
    ctx.globalAlpha = alpha;

    // 뼈대 연결선
    const links = [
      { from: 'head', to: 'neck', color: '#f59e0b' },
      { from: 'neck', to: 'pelvis', color: '#10b981' },
      { from: 'neck', to: 'shoulder_l', color: '#06b6d4' },
      { from: 'shoulder_l', to: 'elbow_l', color: '#06b6d4' },
      { from: 'elbow_l', to: 'hand_l', color: '#06b6d4' },
      { from: 'neck', to: 'shoulder_r', color: '#a855f7' },
      { from: 'shoulder_r', to: 'elbow_r', color: '#a855f7' },
      { from: 'elbow_r', to: 'hand_r', color: '#a855f7' },
      { from: 'pelvis', to: 'knee_l', color: '#f97316' },
      { from: 'knee_l', to: 'foot_l', color: '#f97316' },
      { from: 'pelvis', to: 'knee_r', color: '#f43f5e' },
      { from: 'knee_r', to: 'foot_r', color: '#f43f5e' }
    ];

    links.forEach(link => {
      const p1 = skeleton[link.from];
      const p2 = skeleton[link.to];
      if (!p1 || !p2) return;

      const sx1 = destX + p1.x * scaleX;
      const sy1 = destY + p1.y * scaleY;
      const sx2 = destX + p2.x * scaleX;
      const sy2 = destY + p2.y * scaleY;

      ctx.strokeStyle = link.color;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sx1, sy1);
      ctx.lineTo(sx2, sy2);
      ctx.stroke();
    });

    // 관절 노드
    for (const key in skeleton) {
      const pt = skeleton[key];
      const sx = destX + pt.x * scaleX;
      const sy = destY + pt.y * scaleY;

      ctx.beginPath();
      ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#0284c7';
      ctx.stroke();
    }

    ctx.restore();
  }

  return {
    JOINT_NAMES,
    BONE_DEFS,
    solveSkeletonPose,
    SkinnedMesh,
    drawSkeletonOverlay,
    solve2BoneIK
  };
}));
