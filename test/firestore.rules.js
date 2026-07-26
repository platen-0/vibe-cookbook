import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
  arrayUnion,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  writeBatch
} from 'firebase/firestore';

const projectId = 'demo-vibe-cookbook-rules';
let environment;

const profile = (uid, email) => ({
  username: uid,
  usernameNormalized: uid,
  firstName: uid,
  email,
  onboardingComplete: true,
  profileVersion: 1,
  personalKitchenId: `personal_${uid}`
});

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8')
    }
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await Promise.all([
      setDoc(doc(db, 'users/tal'), profile('tal', 'tal@example.com')),
      setDoc(doc(db, 'users/einav'), profile('einav', 'einav@example.com')),
      setDoc(doc(db, 'users/admin'), profile('admin', 'admin@example.com')),
      setDoc(doc(db, 'users/member'), profile('member', 'member@example.com')),
      setDoc(doc(db, 'users/outsider'), profile('outsider', 'outsider@example.com')),
      setDoc(doc(db, 'users/incomplete'), {
        email: 'incomplete@example.com',
        onboardingComplete: false
      }),
      setDoc(doc(db, 'kitchens/schreiber'), {
        name: 'שרייבר',
        type: 'shared',
        ownerUid: 'tal',
        memberIds: ['tal', 'einav', 'admin', 'member'],
        memberRoles: {
          tal: 'owner',
          einav: 'member',
          admin: 'admin',
          member: 'member'
        },
        recipeIds: ['shared_recipe']
      }),
      setDoc(doc(db, 'recipes/legacy'), {
        name: 'Legacy',
        tags: ['tal']
      }),
      setDoc(doc(db, 'recipes/public_recipe'), {
        name: 'Public',
        ownerUid: 'tal',
        homeKitchenId: 'personal_tal',
        visibility: 'public',
        sharedKitchenIds: [],
        editorUids: [],
        tags: ['tal']
      }),
      setDoc(doc(db, 'recipes/private_recipe'), {
        name: 'Private',
        ownerUid: 'tal',
        homeKitchenId: 'personal_tal',
        visibility: 'private',
        sharedKitchenIds: [],
        editorUids: [],
        tags: ['tal']
      }),
      setDoc(doc(db, 'recipes/shared_recipe'), {
        name: 'Shared',
        ownerUid: 'tal',
        homeKitchenId: 'personal_tal',
        visibility: 'private',
        sharedKitchenIds: ['schreiber'],
        editorUids: ['tal', 'admin'],
        tags: ['tal', 'quick']
      }),
      setDoc(doc(db, 'users/member/recipeAccess/shared_recipe'), {
        recipeId: 'shared_recipe',
        active: true,
        allowCopy: true,
        primaryPolicyId: 'seed-policy',
        policyIds: ['seed-policy']
      })
    ]);
  });
});

after(async () => {
  await environment.cleanup();
});

function authed(uid, email = `${uid}@example.com`) {
  return environment.authenticatedContext(uid, { email }).firestore();
}

test('legacy and public recipes remain public while private recipes require access', async () => {
  const anonymous = environment.unauthenticatedContext().firestore();
  await assertSucceeds(getDoc(doc(anonymous, 'recipes/legacy')));
  await assertSucceeds(getDoc(doc(anonymous, 'recipes/public_recipe')));
  await assertFails(getDoc(doc(anonymous, 'recipes/private_recipe')));
  await assertSucceeds(getDoc(doc(authed('tal'), 'recipes/private_recipe')));
  await assertSucceeds(getDoc(doc(authed('member'), 'recipes/shared_recipe')));
  await assertFails(getDoc(doc(authed('outsider'), 'recipes/shared_recipe')));
});

test('complete profiles can create only their own canonical recipes', async () => {
  await assertSucceeds(setDoc(doc(authed('einav'), 'recipes/einav_new'), {
    name: 'Einav recipe',
    ownerUid: 'einav',
    homeKitchenId: 'personal_einav',
    visibility: 'private',
    sharedKitchenIds: [],
    tags: ['einav']
  }));
  await assertFails(setDoc(doc(authed('einav'), 'recipes/forged_owner'), {
    name: 'Forged',
    ownerUid: 'tal',
    homeKitchenId: 'personal_tal',
    visibility: 'private',
    sharedKitchenIds: [],
    tags: []
  }));
  await assertFails(setDoc(doc(authed('incomplete'), 'recipes/incomplete_new'), {
    name: 'Incomplete',
    ownerUid: 'incomplete',
    homeKitchenId: 'personal_incomplete',
    visibility: 'private',
    sharedKitchenIds: [],
    tags: []
  }));
});

test('owners and kitchen admins edit shared recipes; members and outsiders cannot', async () => {
  await assertSucceeds(updateDoc(doc(authed('tal'), 'recipes/shared_recipe'), {
    notes: 'owner edit'
  }));
  await assertSucceeds(updateDoc(doc(authed('admin'), 'recipes/shared_recipe'), {
    notes: 'admin edit'
  }));
  await assertFails(updateDoc(doc(authed('member'), 'recipes/shared_recipe'), {
    notes: 'member edit'
  }));
  await assertFails(updateDoc(doc(authed('outsider'), 'recipes/shared_recipe'), {
    notes: 'outsider edit'
  }));
});

test('automation cannot replace protected human recipe text', async () => {
  const recipeRef = doc(authed('tal'), 'recipes/private_recipe');
  await assertSucceeds(updateDoc(recipeRef, {
    content: {
      text: 'טקסט שתוקן ידנית',
      textMeta: { source: 'human', protected: true }
    }
  }));
  await assertFails(updateDoc(recipeRef, {
    content: {
      text: 'חילוץ אוטומטי חדש',
      textMeta: { source: 'generated', protected: false }
    }
  }));
  await assertSucceeds(updateDoc(recipeRef, {
    content: {
      text: 'תיקון אנושי נוסף',
      textMeta: { source: 'human', protected: true }
    }
  }));
});

test('recipe revisions are append-only and restricted to editors', async () => {
  const ownerRevision = doc(authed('tal'), 'recipes/shared_recipe/revisions/rev_owner');
  await assertSucceeds(setDoc(ownerRevision, {
    kind: 'recipe-text',
    value: { text: 'previous' },
    editorUid: 'tal',
    createdAt: '2026-07-26T10:00:00.000Z'
  }));
  await assertSucceeds(getDoc(
    doc(authed('member'), 'recipes/shared_recipe/revisions/rev_owner')
  ));
  await assertFails(updateDoc(ownerRevision, { value: { text: 'tampered' } }));
  await assertFails(setDoc(
    doc(authed('member'), 'recipes/shared_recipe/revisions/rev_member'),
    {
      kind: 'recipe-text',
      value: { text: 'forged' },
      editorUid: 'member'
    }
  ));
});

test('personal recipe overrides are private to their user', async () => {
  await assertSucceeds(setDoc(
    doc(authed('member'), 'users/member/recipeOverrides/shared_recipe'),
    { translations: { en: { text: 'My correction', source: 'human' } } }
  ));
  await assertSucceeds(getDoc(
    doc(authed('member'), 'users/member/recipeOverrides/shared_recipe')
  ));
  await assertFails(getDoc(
    doc(authed('tal'), 'users/member/recipeOverrides/shared_recipe')
  ));
});

test('favorites are private to their user', async () => {
  await assertSucceeds(setDoc(doc(authed('einav'), 'users/einav/favorites/public_recipe'), {
    recipeId: 'public_recipe'
  }));
  await assertFails(setDoc(doc(authed('einav'), 'users/tal/favorites/public_recipe'), {
    recipeId: 'public_recipe'
  }));
});

test('a username reservation cannot be overwritten by another user', async () => {
  await assertSucceeds(setDoc(doc(authed('tal'), 'usernames/tal'), {
    uid: 'tal',
    username: 'tal',
    firstName: 'טל'
  }));
  await assertFails(setDoc(doc(authed('einav'), 'usernames/tal'), {
    uid: 'einav',
    username: 'tal',
    firstName: 'עינב'
  }));
});

test('only kitchen admins can issue kitchen invitations', async () => {
  const invitation = {
    type: 'kitchen',
    title: 'שרייבר',
    kitchenId: 'schreiber',
    kitchenName: 'שרייבר',
    role: 'member',
    targetUid: 'outsider',
    targetEmail: null,
    inviterUid: 'admin',
    status: 'pending'
  };
  await assertSucceeds(setDoc(doc(authed('admin'), 'invitations/admin_invite'), invitation));
  await assertFails(setDoc(doc(authed('member'), 'invitations/member_invite'), {
    ...invitation,
    inviterUid: 'member'
  }));
});

test('an invited user can atomically join with exactly the invited role', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'invitations/join_invite'), {
      type: 'kitchen',
      title: 'שרייבר',
      kitchenId: 'schreiber',
      kitchenName: 'שרייבר',
      role: 'member',
      targetUid: 'outsider',
      targetEmail: null,
      inviterUid: 'admin',
      status: 'pending'
    });
  });

  const db = authed('outsider');
  const batch = writeBatch(db);
  batch.update(doc(db, 'kitchens/schreiber'), {
    memberIds: arrayUnion('outsider'),
    'memberRoles.outsider': 'member',
    lastAcceptedInvitationId: 'join_invite'
  });
  batch.update(doc(db, 'invitations/join_invite'), {
    status: 'accepted',
    acceptedByUid: 'outsider'
  });
  await assertSucceeds(batch.commit());

  await assertSucceeds(setDoc(
    doc(db, 'users/outsider/recipeAccess/shared_recipe'),
    {
      recipeId: 'shared_recipe',
      active: true,
      allowCopy: true,
      grantKind: 'kitchen',
      kitchenId: 'schreiber',
      invitationId: 'join_invite'
    }
  ));
  await assertSucceeds(getDoc(doc(db, 'recipes/shared_recipe')));
});

test('recipe owners can grant access but arbitrary users cannot', async () => {
  await assertSucceeds(setDoc(doc(authed('tal'), 'users/einav/recipeAccess/private_recipe'), {
    recipeId: 'private_recipe',
    active: true,
    primaryPolicyId: 'policy',
    policyIds: ['policy']
  }));
  await assertFails(setDoc(doc(authed('outsider'), 'users/einav/recipeAccess/private_recipe'), {
    recipeId: 'private_recipe',
    active: true,
    primaryPolicyId: 'policy',
    policyIds: ['policy']
  }));
});

test('recipe ownership and home kitchen cannot be reassigned through an update', async () => {
  await assertFails(updateDoc(doc(authed('tal'), 'recipes/private_recipe'), {
    ownerUid: 'einav'
  }));
  await assertFails(updateDoc(doc(authed('tal'), 'recipes/private_recipe'), {
    homeKitchenId: 'personal_einav'
  }));
  const snapshot = await getDoc(doc(authed('tal'), 'recipes/private_recipe'));
  assert.equal(snapshot.data().ownerUid, 'tal');
});
