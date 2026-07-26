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
  deleteField,
  deleteDoc,
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
        nameNormalized: 'שרייבר',
        directoryKey: 'schreiber-key',
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
      setDoc(doc(db, 'kitchenDirectory/schreiber-key'), {
        kitchenId: 'schreiber',
        kitchenName: 'שרייבר',
        normalizedName: 'שרייבר',
        ownerUid: 'tal',
        adminUids: ['tal', 'admin']
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
        grantKind: 'kitchen',
        kitchenId: 'schreiber'
      })
    ]);
  });
});

after(async () => {
  await environment.cleanup();
});

function authed(uid, email = `${uid}@example.com`) {
  return environment.authenticatedContext(uid, {
    email,
    email_verified: true
  }).firestore();
}

test('ownerless legacy recipes fail closed while explicit public recipes remain public', async () => {
  const anonymous = environment.unauthenticatedContext().firestore();
  await assertFails(getDoc(doc(anonymous, 'recipes/legacy')));
  await assertSucceeds(getDoc(doc(anonymous, 'recipes/public_recipe')));
  await assertFails(getDoc(doc(anonymous, 'recipes/private_recipe')));
  await assertSucceeds(getDoc(doc(
    authed('migration-editor', 'taladani@gmail.com'),
    'recipes/legacy'
  )));
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

test('delegated recipe editors cannot change ACLs, publish, or delete the owner recipe', async () => {
  const adminDb = authed('admin');
  await assertFails(updateDoc(doc(adminDb, 'recipes/shared_recipe'), {
    visibility: 'public'
  }));
  await assertFails(updateDoc(doc(adminDb, 'recipes/shared_recipe'), {
    editorUids: ['tal', 'admin', 'outsider']
  }));
  await assertFails(updateDoc(doc(adminDb, 'recipes/shared_recipe'), {
    sharedKitchenIds: ['schreiber', 'forged-kitchen']
  }));
  await assertFails(deleteDoc(doc(adminDb, 'recipes/shared_recipe')));

  await assertSucceeds(updateDoc(doc(authed('tal'), 'recipes/shared_recipe'), {
    visibility: 'public',
    editorUids: ['tal', 'admin', 'einav']
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

test('a materialized shared-kitchen editor can save the first generated recipe text', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'recipes/extraction_target'), {
      name: 'Extraction target',
      ownerUid: 'tal',
      homeKitchenId: 'personal_tal',
      visibility: 'private',
      sharedKitchenIds: ['schreiber'],
      editorUids: ['tal', 'admin'],
      tags: ['tal', 'kid-friendly'],
      content: {
        url: 'https://example.com/recipe'
      }
    });
  });

  await assertSucceeds(updateDoc(
    doc(authed('admin'), 'recipes/extraction_target'),
    {
      'content.text': 'מרכיבים\\n1 כוס מים\\n\\nהכנה\\nמערבבים.',
      'content.textMeta': {
        source: 'generated',
        protected: false,
        pipelineVersion: 'extraction-v1'
      }
    }
  ));
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
  await assertFails(setDoc(doc(authed('admin'), 'invitations/owner_role_invite'), {
    ...invitation,
    role: 'owner'
  }));
});

test('an invitation target cannot retarget or rewrite the invitation while accepting it', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'invitations/rewrite_attempt'), {
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

  await assertFails(updateDoc(
    doc(authed('outsider'), 'invitations/rewrite_attempt'),
    {
      status: 'accepted',
      acceptedByUid: 'outsider',
      kitchenId: 'forged-kitchen',
      role: 'owner'
    }
  ));
  await assertSucceeds(updateDoc(
    doc(authed('outsider'), 'invitations/rewrite_attempt'),
    {
      status: 'accepted',
      acceptedByUid: 'outsider'
    }
  ));
});

test('email hash directory is not an authorization oracle', async () => {
  await assertFails(setDoc(
    doc(authed('outsider'), 'emailDirectory/forged-victim-hash'),
    { uid: 'outsider' }
  ));
  await assertFails(getDoc(
    doc(authed('outsider'), 'emailDirectory/existing-hash')
  ));
});

test('shared kitchen names can be looked up exactly without exposing membership', async () => {
  await assertSucceeds(getDoc(
    doc(authed('outsider'), 'kitchenDirectory/schreiber-key')
  ));

  const db = authed('einav');
  const batch = writeBatch(db);
  batch.set(doc(db, 'kitchens/einav-friends'), {
    name: 'החברים של עינב',
    nameNormalized: 'החברים של עינב',
    directoryKey: 'einav-friends-key',
    type: 'shared',
    ownerUid: 'einav',
    memberIds: ['einav'],
    memberRoles: { einav: 'owner' }
  });
  batch.set(doc(db, 'kitchenDirectory/einav-friends-key'), {
    kitchenId: 'einav-friends',
    kitchenName: 'החברים של עינב',
    normalizedName: 'החברים של עינב',
    ownerUid: 'einav',
    adminUids: ['einav']
  });
  await assertSucceeds(batch.commit());

  await assertFails(setDoc(
    doc(authed('outsider'), 'kitchenDirectory/forged'),
    {
      kitchenId: 'schreiber',
      kitchenName: 'שרייבר',
      normalizedName: 'שרייבר',
      ownerUid: 'outsider',
      adminUids: ['outsider']
    }
  ));
});

test('kitchen admins cannot bypass the approved join flow or rewrite owner roles', async () => {
  const adminDb = authed('admin');
  await assertFails(updateDoc(doc(adminDb, 'kitchens/schreiber'), {
    memberIds: arrayUnion('outsider'),
    'memberRoles.outsider': 'member'
  }));
  await assertFails(updateDoc(doc(adminDb, 'kitchens/schreiber'), {
    'memberRoles.tal': 'member'
  }));
  await assertSucceeds(updateDoc(doc(adminDb, 'kitchens/schreiber'), {
    recipeIds: arrayUnion('another_shared_recipe')
  }));
});

test('only the kitchen owner can revoke a non-owner membership', async () => {
  const ownerDb = authed('tal');
  await assertSucceeds(updateDoc(doc(ownerDb, 'kitchens/schreiber'), {
    memberIds: ['tal', 'einav', 'admin'],
    'memberRoles.member': deleteField()
  }));
  await assertFails(getDoc(doc(authed('member'), 'kitchens/schreiber')));
  await assertFails(getDoc(doc(authed('member'), 'recipes/shared_recipe')));

  await assertFails(updateDoc(doc(authed('admin'), 'kitchens/schreiber'), {
    memberIds: ['tal', 'einav'],
    'memberRoles.admin': deleteField()
  }));
  await assertFails(updateDoc(doc(ownerDb, 'kitchens/schreiber'), {
    memberIds: ['einav', 'admin'],
    'memberRoles.tal': deleteField()
  }));
});

test('kitchen directory admins can add only their own verified admin membership', async () => {
  await assertFails(updateDoc(doc(authed('admin'), 'kitchenDirectory/schreiber-key'), {
    adminUids: arrayUnion('outsider')
  }));

  await environment.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'kitchens/schreiber'), {
      memberIds: arrayUnion('outsider'),
      'memberRoles.outsider': 'admin'
    });
  });
  await assertSucceeds(updateDoc(
    doc(authed('outsider'), 'kitchenDirectory/schreiber-key'),
    { adminUids: arrayUnion('outsider') }
  ));
});

test('admin approval directly and atomically grants kitchen membership and recipe access', async () => {
  const request = {
    targetKind: 'kitchen',
    targetKitchenId: 'schreiber',
    targetKitchenName: 'שרייבר',
    directoryKey: 'schreiber-key',
    recipientUids: ['tal', 'admin'],
    requesterUid: 'outsider',
    requesterName: 'Outsider',
    requesterUsername: 'outsider',
    requesterEmail: 'outsider@example.com',
    status: 'pending'
  };
  await assertSucceeds(setDoc(
    doc(authed('outsider'), 'kitchenAccessRequests/valid-request'),
    request
  ));
  await assertFails(setDoc(
    doc(authed('outsider'), 'kitchenAccessRequests/forged-request'),
    { ...request, recipientUids: ['member'] }
  ));
  await assertFails(updateDoc(
    doc(authed('member'), 'kitchenAccessRequests/valid-request'),
    { status: 'approved', resolverUid: 'member' }
  ));

  const adminDb = authed('admin');
  const approval = writeBatch(adminDb);
  approval.update(doc(adminDb, 'kitchens/schreiber'), {
    memberIds: arrayUnion('outsider'),
    'memberRoles.outsider': 'member',
    lastApprovedAccessRequestId: 'valid-request'
  });
  approval.update(doc(adminDb, 'kitchenAccessRequests/valid-request'), {
    status: 'approved',
    resolverUid: 'admin',
    resolvedKitchenId: 'schreiber'
  });
  approval.set(doc(adminDb, 'users/outsider/recipeAccess/shared_recipe'), {
    recipeId: 'shared_recipe',
    active: true,
    allowCopy: true,
    grantKind: 'kitchen',
    kitchenId: 'schreiber',
    sourceAccessRequestId: 'valid-request',
    grantedByUid: 'admin'
  });
  await assertSucceeds(approval.commit());
  await assertSucceeds(getDoc(doc(authed('outsider'), 'recipes/shared_recipe')));

  await assertFails(setDoc(
    doc(authed('outsider'), 'users/outsider/recipeAccess/private_recipe'),
    {
      recipeId: 'private_recipe',
      active: true,
      grantKind: 'kitchen',
      kitchenId: 'schreiber',
      sourceAccessRequestId: 'valid-request',
      grantedByUid: 'outsider'
    }
  ));
  await assertFails(setDoc(
    doc(adminDb, 'users/outsider/recipeAccess/private_recipe'),
    {
      recipeId: 'private_recipe',
      active: true,
      grantKind: 'kitchen',
      kitchenId: 'schreiber',
      sourceAccessRequestId: 'valid-request',
      grantedByUid: 'admin'
    }
  ));
});

test('direct approval materializes access for a full kitchen in one batch', async () => {
  const recipeIds = Array.from({ length: 30 }, (_, index) => `bulk_recipe_${index}`);
  await environment.withSecurityRulesDisabled(async context => {
    await updateDoc(doc(context.firestore(), 'kitchens/schreiber'), {
      recipeIds
    });
  });

  const request = {
    targetKind: 'user',
    targetUid: 'admin',
    recipientUids: ['admin'],
    requesterUid: 'outsider',
    requesterName: 'Outsider',
    requesterUsername: 'outsider',
    requesterEmail: 'outsider@example.com',
    status: 'pending'
  };
  await assertSucceeds(setDoc(
    doc(authed('outsider'), 'kitchenAccessRequests/bulk-request'),
    request
  ));

  const adminDb = authed('admin');
  const approval = writeBatch(adminDb);
  approval.update(doc(adminDb, 'kitchens/schreiber'), {
    memberIds: arrayUnion('outsider'),
    'memberRoles.outsider': 'member',
    lastApprovedAccessRequestId: 'bulk-request'
  });
  approval.update(doc(adminDb, 'kitchenAccessRequests/bulk-request'), {
    status: 'approved',
    resolverUid: 'admin',
    resolvedKitchenId: 'schreiber'
  });
  recipeIds.forEach(recipeId => {
    approval.set(doc(adminDb, `users/outsider/recipeAccess/${recipeId}`), {
      recipeId,
      active: true,
      allowCopy: true,
      grantKind: 'kitchen',
      kitchenId: 'schreiber',
      sourceAccessRequestId: 'bulk-request',
      grantedByUid: 'admin'
    });
  });
  await assertSucceeds(approval.commit());
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

test('an invited user cannot alter existing member roles while joining', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'invitations/role_tamper_invite'), {
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
    'memberRoles.tal': 'member',
    lastAcceptedInvitationId: 'role_tamper_invite'
  });
  batch.update(doc(db, 'invitations/role_tamper_invite'), {
    status: 'accepted',
    acceptedByUid: 'outsider'
  });
  await assertFails(batch.commit());
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

test('a targeted share policy cannot be reused to claim a different recipe', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'sharePolicies/outsider_shared_policy'), {
      ownerUid: 'tal',
      targetType: 'user',
      targetId: 'outsider',
      targetUid: 'outsider',
      targetEmail: null,
      scopeType: 'recipe',
      scopeValue: 'shared_recipe',
      permissions: { view: true, allowCopy: true },
      active: true
    });
  });

  const outsiderDb = authed('outsider');
  await assertSucceeds(setDoc(
    doc(outsiderDb, 'users/outsider/recipeAccess/shared_recipe'),
    {
      recipeId: 'shared_recipe',
      active: true,
      primaryPolicyId: 'outsider_shared_policy',
      policyIds: ['outsider_shared_policy']
    }
  ));
  await assertFails(setDoc(
    doc(outsiderDb, 'users/outsider/recipeAccess/private_recipe'),
    {
      recipeId: 'private_recipe',
      active: true,
      primaryPolicyId: 'outsider_shared_policy',
      policyIds: ['outsider_shared_policy']
    }
  ));
});

test('disabled or deleted policies immediately stop authorizing stale grants', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await setDoc(doc(db, 'sharePolicies/revocable_policy'), {
      ownerUid: 'tal',
      targetType: 'user',
      targetId: 'outsider',
      targetUid: 'outsider',
      targetEmail: null,
      scopeType: 'recipe',
      scopeValue: 'private_recipe',
      includeFuture: false,
      recipeIds: ['private_recipe'],
      permissions: { view: true, allowCopy: true },
      active: true
    });
    await setDoc(doc(db, 'users/outsider/recipeAccess/private_recipe'), {
      recipeId: 'private_recipe',
      active: true,
      primaryPolicyId: 'revocable_policy',
      policyIds: ['revocable_policy']
    });
  });

  const outsiderDb = authed('outsider');
  await assertSucceeds(getDoc(doc(outsiderDb, 'recipes/private_recipe')));
  await assertSucceeds(updateDoc(
    doc(authed('tal'), 'sharePolicies/revocable_policy'),
    { active: false }
  ));
  await assertFails(getDoc(doc(outsiderDb, 'recipes/private_recipe')));
  await assertSucceeds(deleteDoc(
    doc(authed('tal'), 'sharePolicies/revocable_policy')
  ));
  await assertFails(getDoc(doc(outsiderDb, 'recipes/private_recipe')));
});

test('non-future collection policies grant only the enumerated recipes', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'sharePolicies/quick_snapshot'), {
      ownerUid: 'tal',
      targetType: 'user',
      targetId: 'outsider',
      targetUid: 'outsider',
      targetEmail: null,
      scopeType: 'tag',
      scopeValue: 'quick',
      includeFuture: false,
      recipeIds: ['shared_recipe'],
      permissions: { view: true, allowCopy: true },
      active: true
    });
    await setDoc(doc(context.firestore(), 'recipes/future_quick_recipe'), {
      name: 'Later quick recipe',
      ownerUid: 'tal',
      homeKitchenId: 'personal_tal',
      visibility: 'private',
      sharedKitchenIds: [],
      editorUids: [],
      tags: ['quick']
    });
  });

  const outsiderDb = authed('outsider');
  await assertSucceeds(setDoc(
    doc(outsiderDb, 'users/outsider/recipeAccess/shared_recipe'),
    {
      recipeId: 'shared_recipe',
      active: true,
      primaryPolicyId: 'quick_snapshot',
      policyIds: ['quick_snapshot']
    }
  ));
  await assertFails(setDoc(
    doc(outsiderDb, 'users/outsider/recipeAccess/future_quick_recipe'),
    {
      recipeId: 'future_quick_recipe',
      active: true,
      primaryPolicyId: 'quick_snapshot',
      policyIds: ['quick_snapshot']
    }
  ));
});

test('new share policies require an unambiguous target and a bounded recipe snapshot', async () => {
  const ownerDb = authed('tal');
  const basePolicy = {
    ownerUid: 'tal',
    targetType: 'user',
    targetId: 'outsider',
    targetUid: 'outsider',
    targetEmail: null,
    scopeType: 'all',
    scopeValue: null,
    includeFuture: false,
    recipeIds: ['private_recipe'],
    permissions: { view: true, allowCopy: true },
    active: true
  };
  await assertSucceeds(setDoc(
    doc(ownerDb, 'sharePolicies/valid_new_policy'),
    basePolicy
  ));
  await assertFails(setDoc(
    doc(ownerDb, 'sharePolicies/ambiguous_target'),
    {
      ...basePolicy,
      targetEmail: 'outsider@example.com'
    }
  ));
  await assertFails(setDoc(
    doc(ownerDb, 'sharePolicies/missing_snapshot'),
    {
      ...basePolicy,
      recipeIds: null
    }
  ));
});

test('share policy owners cannot reassign policy ownership', async () => {
  await environment.withSecurityRulesDisabled(async context => {
    await setDoc(doc(context.firestore(), 'sharePolicies/owned_policy'), {
      ownerUid: 'tal',
      targetType: 'user',
      targetId: 'outsider',
      targetUid: 'outsider',
      targetEmail: null,
      scopeType: 'all',
      scopeValue: null,
      permissions: { view: true, allowCopy: true },
      active: true
    });
  });

  await assertFails(updateDoc(doc(authed('tal'), 'sharePolicies/owned_policy'), {
    ownerUid: 'einav'
  }));
});

test('unverified email claims do not receive legacy editor authority', async () => {
  const db = environment.authenticatedContext('forged-editor', {
    email: 'taladani@gmail.com',
    email_verified: false
  }).firestore();
  await assertFails(updateDoc(doc(db, 'recipes/legacy'), {
    name: 'forged edit'
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
